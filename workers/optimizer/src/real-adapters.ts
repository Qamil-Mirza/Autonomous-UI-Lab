import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoalCheckResult, type CandidateAdapter, type ScreenshotRef, type SimulationAdapter } from "@ghostloop/contracts";
import { checkGoal, createCandidateAdapter } from "@ghostloop/prototype-adapter";
import { createSimulationAdapter } from "@ghostloop/simulator";
import { createClaudeJudge } from "./claude/judge";

export type AdapterChoice = "mock" | "real";

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
/** Where the prototype dev server runs; candidate URLs and goal checks use it. */
export const DEFAULT_PROTOTYPE_URL = "http://localhost:5173";
/** Simulator evidence (screenshots, traces); the dashboard serves this directory at `/artifacts`. */
export const DEFAULT_ARTIFACTS_DIR = path.join(REPO_ROOT, "workers/simulator/artifacts");

/** `--<name> mock|real`; `--real` sets every adapter to real; absent means mock. */
export function parseAdapterFlag(argv: string[], name: "simulation" | "candidates"): AdapterChoice {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return argv.includes("--real") ? "real" : "mock";
  const v = argv[i + 1];
  if (v !== "mock" && v !== "real") throw new Error(`--${name} must be one of: mock, real`);
  return v;
}

/**
 * Maps a screenshot the simulator saved under `artifactsDir` to its `/artifacts/...` URL, so the dashboard can show
 * it. Files outside that directory keep their local path (the dashboard then shows no replay for them).
 */
export function screenshotPublisher(artifactsDir: string) {
  const root = path.resolve(artifactsDir);
  return async (shot: ScreenshotRef): Promise<ScreenshotRef> => {
    const file = path.resolve(shot.uri);
    const rel = path.relative(root, file);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return shot;
    return { ...shot, uri: `/artifacts/${rel.split(path.sep).map(encodeURIComponent).join("/")}` };
  };
}

/** Jaclyn's simulator (Group B): real browsers on the prototype, Bitdeer choosing actions, Claude judging each trial. */
export function createRealSimulation(opts: { prototypeUrl?: string; artifactsDir?: string } = {}): SimulationAdapter {
  const baseUrl = opts.prototypeUrl ?? DEFAULT_PROTOTYPE_URL;
  const artifactsDir = opts.artifactsDir ?? DEFAULT_ARTIFACTS_DIR;
  return createSimulationAdapter({
    outputDir: path.join(artifactsDir, "batches"),
    provenance: "live-bitdeer",
    goalAdapter: { checkGoal: async (runId) => GoalCheckResult.parse(await checkGoal(runId, { baseUrl })) },
    publishScreenshot: screenshotPublisher(artifactsDir),
    judge: createClaudeJudge(),
  });
}

/** Emma's CandidateAdapter (Group C): applies approved patches into a new design version the prototype serves. */
export function createRealCandidates(opts: { prototypeUrl?: string; designsDir?: string } = {}): CandidateAdapter {
  return createCandidateAdapter({ baseUrl: opts.prototypeUrl ?? DEFAULT_PROTOTYPE_URL, designsDir: opts.designsDir });
}
