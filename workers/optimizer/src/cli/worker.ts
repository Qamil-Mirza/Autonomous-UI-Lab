import path from "node:path";
import { config } from "dotenv";
import { DEFAULT_TOKEN_PATH as TOKEN_PATH, resolveTarget } from "../spacetime-env";
import { startWorker } from "../worker";
import { analysisLabel, parseAnalysisFlag, selectAnalysis } from "../claude/select";
import { createRealCandidates, createRealSimulation, parseAdapterFlag, REPO_ROOT } from "../real-adapters";
import { createImports } from "../imported";

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
  // Imported Figma Make apps (Docker sandbox, import API for the dashboard). On by default; `--imports off` disables.
  const importsFlag = argv.includes("--imports") ? argv[argv.indexOf("--imports") + 1] : "on";
  if (importsFlag !== "on" && importsFlag !== "off") throw new Error("--imports must be one of: on, off");
  const importPort = Number(process.env.GHOSTLOOP_IMPORT_PORT ?? "5180");
  const imports = importsFlag === "on" ? createImports({ log: console.log }) : undefined;

  if (simulation === "mock" && candidates === "mock" && choice === "mock") console.log("MOCK ADAPTERS — synthetic fixtures, not real evidence");
  console.log(`simulation: ${simulation === "real" ? "real (Playwright + Bitdeer on the prototype)" : "mock fixtures"}`);
  console.log(`candidates: ${candidates === "real" ? "real (prototype-adapter patch engine)" : "mock fixtures"}`);
  console.log(`analysis: ${analysisLabel(choice)}`);
  console.log(`imports: ${imports ? `on (real Playwright + Bitdeer; success = frozen page checks, or a Claude judge for tasks without checks; API port ${importPort})` : "off"}`);
  if (imports && choice === "mock") console.warn("imports with mock analysis: the mock model only knows onboarding elements, so imported experiments will stop with NO_VALID_PATCH; use --analysis claude");
  if (imports && !process.env.BITDEER_API_KEY) console.warn("BITDEER_API_KEY is not set; imported-app trials will fail as model errors");
  if (imports && !process.env.ANTHROPIC_API_KEY) console.warn("ANTHROPIC_API_KEY is not set; check suggestions and judged imported tasks (no checks) will fail");
  if (simulation === "real" && !process.env.BITDEER_API_KEY) console.warn("BITDEER_API_KEY is not set; real simulation runs will fail");
  if (simulation === "real" && !process.env.ANTHROPIC_API_KEY) console.warn("ANTHROPIC_API_KEY is not set; the Claude judge will fail and every trial will be a model error");
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
    ...(imports ? { imports: { ...imports, port: importPort } } : {}),
    onDisconnect: () => process.exit(1),
  });
  console.log(`worker running (token ${TOKEN_PATH}); Ctrl+C to stop`);
  let stoppingAt = 0;
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      // npm and tsx relay the terminal's signal, so one Ctrl+C can arrive several times at once: repeats within
      // 2 s are the same request. A later signal forces the exit; the next worker start removes leftover containers.
      if (stoppingAt) {
        if (Date.now() - stoppingAt > 2000) process.exit(1);
        return;
      }
      stoppingAt = Date.now();
      console.log("stopping: removing sandbox containers and disconnecting…");
      // close() also stops every sandbox container this worker owns.
      void worker.close().finally(() => {
        console.log("stopped");
        process.exit(0);
      });
    });
  }
}

main().catch((err: unknown) => {
  console.error(`worker failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
