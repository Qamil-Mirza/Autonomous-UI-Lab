import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DATABASE, DEFAULT_URI } from "@ghostloop/db";
import { SpacetimeStore } from "./spacetime-store";

/** The worker's persisted SpacetimeDB token, shared by `worker.ts` and `demo:mock --store spacetime` (spec §8.1). */
export const DEFAULT_TOKEN_PATH = fileURLToPath(new URL("../../../.ghostloop/worker-token", import.meta.url));

/** Server and database from `GHOSTLOOP_STDB_URI` / `GHOSTLOOP_STDB_DB`, defaulting to the local `ghostloop` module. */
export function resolveTarget(env: NodeJS.ProcessEnv = process.env): { uri: string; database: string } {
  return { uri: env.GHOSTLOOP_STDB_URI ?? DEFAULT_URI, database: env.GHOSTLOOP_STDB_DB ?? DEFAULT_DATABASE };
}

/**
 * Opens a store as the writer with the token saved at `tokenPath`, then saves the (possibly new) token back, readable
 * by the owner only. `onDisconnect` is passed to `SpacetimeStore.open`.
 */
export async function openWriterStore(opts: {
  uri: string;
  database: string;
  tokenPath: string;
  onDisconnect?: (err: Error) => void;
}): Promise<SpacetimeStore> {
  const saved = existsSync(opts.tokenPath) ? readFileSync(opts.tokenPath, "utf8").trim() : "";
  let store: SpacetimeStore;
  try {
    store = await SpacetimeStore.open({ uri: opts.uri, database: opts.database, token: saved || undefined, onDisconnect: opts.onDisconnect });
  } catch (e) {
    // A token the server rejects (e.g. from another server or an expired key) fails the connect itself.
    if (saved && e instanceof Error && e.message.startsWith("CONNECT_FAILED:")) {
      throw new Error(`${e.message}; the saved token may be rejected: delete ${opts.tokenPath} to get a fresh identity`);
    }
    throw e;
  }
  mkdirSync(dirname(opts.tokenPath), { recursive: true });
  writeFileSync(opts.tokenPath, store.token, { mode: 0o600 });
  chmodSync(opts.tokenPath, 0o600); // `mode` only applies when the file is created
  return store;
}
