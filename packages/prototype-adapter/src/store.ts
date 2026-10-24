import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { emptyRunState, RunState } from "./state";
import { isRunId } from "./validation";

// Repo-root .runs/ unless GHOSTLOOP_RUNS_DIR points elsewhere. Read on every call so tests can set it late.
export function defaultRunsDir(): string {
  return process.env.GHOSTLOOP_RUNS_DIR ?? fileURLToPath(new URL("../../../.runs", import.meta.url));
}

export class InvalidRunIdError extends Error {
  constructor(runId: string) {
    super(`invalid runId ${JSON.stringify(runId)}: must match ^run_[A-Za-z0-9_-]+$`);
    this.name = "InvalidRunIdError";
  }
}

export interface RunStore {
  readonly dir: string;
  // Creates (or resets) the run to empty state.
  init(runId: string): Promise<RunState>;
  get(runId: string): Promise<RunState | null>;
  // Applies fn to the current state and persists the result; null when the run was never initialized.
  update(runId: string, fn: (state: RunState) => RunState): Promise<RunState | null>;
  // Returns false when there was nothing to delete.
  remove(runId: string): Promise<boolean>;
  // Writes state as-is, bypassing the action rules. For tests that need states the app can't produce.
  put(runId: string, state: RunState): Promise<void>;
}

export function createRunStore(dir: string = defaultRunsDir()): RunStore {
  // Per-run queue: every operation on a run waits for the previous one, so concurrent requests can't lose writes.
  const queues = new Map<string, Promise<unknown>>();

  const serial = <T>(runId: string, op: () => Promise<T>): Promise<T> => {
    if (!isRunId(runId)) return Promise.reject(new InvalidRunIdError(runId));
    const next = (queues.get(runId) ?? Promise.resolve()).then(op, op);
    const tail = next.catch(() => {});
    queues.set(runId, tail);
    void tail.then(() => {
      if (queues.get(runId) === tail) queues.delete(runId);
    });
    return next;
  };

  const file = (runId: string) => path.join(dir, `${runId}.json`);

  const read = async (runId: string): Promise<RunState | null> => {
    let text: string;
    try {
      text = await readFile(file(runId), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    return RunState.parse(JSON.parse(text));
  };

  // Temp file + rename, so a reader never sees a half-written file.
  const write = async (runId: string, state: RunState) => {
    await mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `.${runId}.${randomUUID()}.tmp`);
    await writeFile(tmp, JSON.stringify(state, null, 2) + "\n");
    await rename(tmp, file(runId));
  };

  return {
    dir,
    init: (runId) =>
      serial(runId, async () => {
        const state = emptyRunState(runId);
        await write(runId, state);
        return state;
      }),
    get: (runId) => serial(runId, () => read(runId)),
    update: (runId, fn) =>
      serial(runId, async () => {
        const current = await read(runId);
        if (!current) return null;
        const next = RunState.parse({ ...fn(current), runId, updatedAt: new Date().toISOString() });
        await write(runId, next);
        return next;
      }),
    remove: (runId) =>
      serial(runId, async () => {
        const existed = (await read(runId)) !== null;
        await rm(file(runId), { force: true });
        return existed;
      }),
    put: (runId, state) => serial(runId, () => write(runId, RunState.parse(state))),
  };
}
