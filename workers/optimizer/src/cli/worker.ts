import path from "node:path";
import { config } from "dotenv";
import { DEFAULT_TOKEN_PATH as TOKEN_PATH, resolveTarget } from "../spacetime-env";
import { startWorker } from "../worker";
import { analysisLabel, parseAnalysisFlag, selectAnalysis } from "../claude/select";
import { createRealCandidates, createRealSimulation, parseAdapterFlag, REPO_ROOT } from "../real-adapters";

// Keys (ANTHROPIC_API_KEY, BITDEER_*) come from the repo-root .env; variables already set in the shell win.
config({ path: path.join(REPO_ROOT, ".env"), quiet: true });

async function main(): Promise<void> {
  const { uri, database } = resolveTarget();
  const argv = process.argv.slice(2);
  const choice = argv.includes("--real") && !argv.includes("--analysis") ? "claude" : parseAnalysisFlag(argv);
  const simulation = parseAdapterFlag(argv, "simulation");
  const candidates = parseAdapterFlag(argv, "candidates");
  const prototypeUrl = process.env.GHOSTLOOP_PROTOTYPE_URL;
  const analysis = selectAnalysis(choice, { warn: console.warn });

  if (simulation === "mock" && candidates === "mock" && choice === "mock") console.log("MOCK ADAPTERS — synthetic fixtures, not real evidence");
  console.log(`simulation: ${simulation === "real" ? "real (Playwright + Bitdeer on the prototype)" : "mock fixtures"}`);
  console.log(`candidates: ${candidates === "real" ? "real (prototype-adapter patch engine)" : "mock fixtures"}`);
  console.log(`analysis: ${analysisLabel(choice)}`);
  if (simulation === "real" && !process.env.BITDEER_API_KEY) console.warn("BITDEER_API_KEY is not set; real simulation runs will fail");
  if (simulation === "real" && candidates === "mock") {
    console.warn("real simulation with mock candidates: the prototype does not serve mock candidate versions, so candidate batches will fail");
  }

  // No reconnect: if the server goes away, exit non-zero (startWorker logs `disconnected: <reason>`); a rerun resumes.
  const worker = await startWorker({
    uri,
    database,
    tokenPath: TOKEN_PATH,
    adapters: {
      analysis,
      simulation: simulation === "real" ? createRealSimulation({ prototypeUrl }) : undefined,
      candidates: candidates === "real" ? createRealCandidates({ prototypeUrl }) : undefined,
    },
    log: console.log,
    onDisconnect: () => process.exit(1),
  });
  console.log(`worker running (token ${TOKEN_PATH}); Ctrl+C to stop`);
  process.once("SIGINT", () => {
    void worker.close().finally(() => process.exit(0));
  });
}

main().catch((err: unknown) => {
  console.error(`worker failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
