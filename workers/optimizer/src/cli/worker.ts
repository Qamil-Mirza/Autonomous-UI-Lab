import { DEFAULT_TOKEN_PATH as TOKEN_PATH, resolveTarget } from "../spacetime-env";
import { startWorker } from "../worker";
import { analysisLabel, parseAnalysisFlag, selectAnalysis } from "../claude/select";

async function main(): Promise<void> {
  const { uri, database } = resolveTarget();
  const choice = parseAnalysisFlag(process.argv.slice(2));
  const analysis = selectAnalysis(choice, { warn: console.warn });
  console.log("MOCK ADAPTERS — synthetic fixtures, not real evidence");
  console.log(`analysis: ${analysisLabel(choice)}`);
  // No reconnect: if the server goes away, exit non-zero (startWorker logs `disconnected: <reason>`); a rerun resumes.
  const worker = await startWorker({ uri, database, tokenPath: TOKEN_PATH, adapters: { analysis }, log: console.log, onDisconnect: () => process.exit(1) });
  console.log(`worker running (token ${TOKEN_PATH}); Ctrl+C to stop`);
  process.once("SIGINT", () => {
    void worker.close().finally(() => process.exit(0));
  });
}

main().catch((err: unknown) => {
  console.error(`worker failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
