import { DEFAULT_TOKEN_PATH as TOKEN_PATH, resolveTarget } from "../spacetime-env";
import { startWorker } from "../worker";

async function main(): Promise<void> {
  const { uri, database } = resolveTarget();
  console.log("MOCK ADAPTERS — synthetic fixtures, not real evidence");
  // No reconnect: if the server goes away, exit non-zero (startWorker logs `disconnected: <reason>`); a rerun resumes.
  const worker = await startWorker({ uri, database, tokenPath: TOKEN_PATH, log: console.log, onDisconnect: () => process.exit(1) });
  console.log(`worker running (token ${TOKEN_PATH}); Ctrl+C to stop`);
  process.once("SIGINT", () => {
    void worker.close().finally(() => process.exit(0));
  });
}

main().catch((err: unknown) => {
  console.error(`worker failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
