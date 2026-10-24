import { CommandKind, type CommandErrorCode, type CommandResult } from "@ghostloop/contracts";
import type { CommandRow, DbConnection } from "@ghostloop/db";
import type { Commands } from "./commands";

/** The module rejects a longer `resultJson` with `TOO_LARGE`, which would leave the command `running` forever. */
const MAX_RESULT_CHARS = 262_144;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const fail = (code: CommandErrorCode, msg: string): CommandResult<never> => ({ ok: false, code, message: msg });

/**
 * Runs designer commands submitted through the `command` table (spec §5). `pending` rows are processed one at a time
 * in id order: `startCommand` (→ `running`), the matching handler, then `completeCommand` with the `CommandResult`.
 * Delivery is at most once: a row this process could not start is skipped, never retried.
 */
export function createCommandProcessor(conn: DbConnection, commands: Commands, log: (line: string) => void) {
  /** Rows whose `startCommand` was refused; they may still look `pending` in this cache. */
  const skipped = new Set<bigint>();
  let pump: Promise<void> | undefined;

  const nextPending = (): CommandRow | undefined => {
    let next: CommandRow | undefined;
    for (const row of conn.db.command.iter()) {
      if (row.status === "pending" && !skipped.has(row.id) && (!next || row.id < next.id)) next = row;
    }
    return next;
  };

  async function run(row: CommandRow): Promise<CommandResult<unknown>> {
    const kind = CommandKind.safeParse(row.kind);
    if (!kind.success) return fail("VALIDATION_FAILED", `unknown command kind ${row.kind}`);
    let payload: unknown;
    try {
      payload = JSON.parse(row.payloadJson);
    } catch (e) {
      return fail("VALIDATION_FAILED", `payload is not valid JSON: ${message(e)}`);
    }
    try {
      return await commands[kind.data](payload);
    } catch (e) {
      return fail("INTERNAL", `${kind.data} failed: ${message(e)}`);
    }
  }

  /** Serializes the result, replacing one the module would refuse (too large, or not serializable). */
  function encode(result: CommandResult<unknown>): { ok: boolean; resultJson: string } {
    let json: string;
    try {
      json = JSON.stringify(result);
    } catch (e) {
      return { ok: false, resultJson: JSON.stringify(fail("INTERNAL", `result could not be serialized: ${message(e)}`)) };
    }
    if (json.length > MAX_RESULT_CHARS) {
      return { ok: false, resultJson: JSON.stringify(fail("INTERNAL", `result of ${json.length} characters exceeds the ${MAX_RESULT_CHARS}-character limit`)) };
    }
    return { ok: result.ok, resultJson: json };
  }

  async function processOne(row: CommandRow): Promise<void> {
    try {
      await conn.reducers.startCommand({ id: row.id });
    } catch (e) {
      skipped.add(row.id);
      log(`[command] #${row.id} ${row.kind} not started: ${message(e)}`);
      return;
    }
    const { ok, resultJson } = encode(await run(row));
    try {
      await conn.reducers.completeCommand({ id: row.id, ok, resultJson });
      log(`[command] #${row.id} ${row.kind} ${ok ? "ok" : `error ${(JSON.parse(resultJson) as { code: string }).code}`}`);
    } catch (e) {
      log(`[command] #${row.id} ${row.kind} could not be completed: ${message(e)}`);
    }
  }

  async function drain(): Promise<void> {
    for (let row = nextPending(); row; row = nextPending()) await processOne(row);
  }

  const kick = () => {
    pump ??= drain().finally(() => {
      pump = undefined;
    });
  };

  return {
    /** Processes rows already pending, then each new one as it arrives. */
    start(): void {
      conn.db.command.onInsert(kick);
      kick();
    },
    /** Resolves when nothing is pending (in this connection's cache) or in progress. */
    async idle(): Promise<void> {
      while (pump) await pump;
    },
    /** Completes every `running` row as `error` / `INTERNAL`; call at startup, before `start`. Returns the count. */
    async failRunning(): Promise<number> {
      const resultJson = JSON.stringify(fail("INTERNAL", "worker restarted; resubmit"));
      let n = 0;
      for (const row of [...conn.db.command.iter()]) {
        if (row.status !== "running") continue;
        await conn.reducers.completeCommand({ id: row.id, ok: false, resultJson });
        log(`[command] #${row.id} ${row.kind} was running when the worker stopped; failed for resubmission`);
        n += 1;
      }
      return n;
    },
  };
}
