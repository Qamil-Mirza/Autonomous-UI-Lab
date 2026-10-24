import { z } from "zod";
import { CommandErrorCode, type CommandKind, type CommandResult } from "@ghostloop/contracts";
import type { DbConnection, EventContext } from "./bindings";
import type { Command } from "./bindings/types";
import { parseRow } from "./rows";

const StoredResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: z.unknown() }),
  z.object({ ok: z.literal(false), code: CommandErrorCode, message: z.string() }),
]);

/**
 * Submits a designer command and resolves with its `CommandResult` once the worker completes the row.
 * `conn` must be subscribed to the `command` table. Rejects with the reducer error if the submission is
 * refused (e.g. `UNKNOWN_COMMAND`) and with `COMMAND_TIMEOUT: ...` if no result arrives within `timeoutMs`.
 */
export function submitCommand(
  conn: DbConnection,
  kind: CommandKind,
  payload: unknown,
  opts: { timeoutMs?: number } = {},
): Promise<CommandResult<unknown>> {
  const timeoutMs = opts.timeoutMs ?? 30000;
  // The SDK hands this exact object back as the reducer event's args, which is how the insert
  // caused by this call is told apart from concurrent submissions on the same connection.
  const args = { kind, payloadJson: JSON.stringify(payload) };
  let id: bigint | undefined;

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      conn.db.command.removeOnInsert(onInsert);
      conn.db.command.removeOnUpdate(onUpdate);
    };
    const finish = (row: Command) => {
      if (row.status !== "ok" && row.status !== "error") return;
      cleanup();
      try {
        resolve(parseRow(StoredResult, "command", String(row.id), row.resultJson ?? "") as CommandResult<unknown>);
      } catch (e) {
        reject(e);
      }
    };
    const onInsert = (ctx: EventContext, row: Command) => {
      if (id !== undefined || ctx.event.tag !== "Reducer" || ctx.event.value.reducer.args !== args) return;
      id = row.id;
      finish(row);
    };
    const onUpdate = (_ctx: EventContext, _old: Command, row: Command) => {
      if (id !== undefined && row.id === id) finish(row);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`COMMAND_TIMEOUT: ${kind} command ${id ?? "(unsent)"} not completed within ${timeoutMs}ms`));
    }, timeoutMs);

    conn.db.command.onInsert(onInsert);
    conn.db.command.onUpdate(onUpdate);
    conn.reducers.submitCommand(args).then(
      () => {
        if (id !== undefined) return;
        cleanup();
        reject(new Error(`COMMAND_NOT_VISIBLE: ${kind} was accepted but its row never reached this connection; subscribe to the command table`));
      },
      (e: unknown) => {
        cleanup();
        reject(e);
      },
    );
  });
}
