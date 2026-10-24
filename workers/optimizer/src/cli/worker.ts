import { fileURLToPath } from "node:url";
import { DEFAULT_DATABASE, DEFAULT_URI } from "@ghostloop/db";
import { startWorker } from "../worker";

const TOKEN_PATH = fileURLToPath(new URL("../../../../.ghostloop/worker-token", import.meta.url));

async function main(): Promise<void> {
  const uri = process.env.GHOSTLOOP_STDB_URI ?? DEFAULT_URI;
  const database = process.env.GHOSTLOOP_STDB_DB ?? DEFAULT_DATABASE;
  console.log("MOCK ADAPTERS — synthetic fixtures, not real evidence");
  const worker = await startWorker({ uri, database, tokenPath: TOKEN_PATH, log: console.log });
  console.log(`worker running (token ${TOKEN_PATH}); Ctrl+C to stop`);
  process.once("SIGINT", () => {
    void worker.close().finally(() => process.exit(0));
  });
}

main().catch((err: unknown) => {
  console.error(`worker failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
