import type { AnalysisAdapter } from "@ghostloop/contracts";
import type { ControllerDeps } from "../controller";
import { createMockAnalysis } from "./analysis";
import { createMockCandidates } from "./candidates";
import { createMockSimulation, type MockSimulationPlan } from "./simulation";

/** Candidate batch fixtures the mocks can replay; `improved` is the default demo and worker outcome. */
export const MOCK_CANDIDATES = {
  improved: "batch.candidate-improved.json",
  flat: "batch.candidate-flat.json",
  "zero-valid": "batch.zero-valid.json",
} as const;
export type MockCandidateName = keyof typeof MOCK_CANDIDATES;

/**
 * The demo's MOCK B/C/model adapters: baseline fixture for the baseline batch, `candidate` for every other batch.
 * Pass `phaseOf` when the process may restart mid-experiment, so the phase comes from stored state rather than from
 * which version this mock happened to see first. Pass `analysis` to swap the mock model for a real one.
 */
export function createMockAdapters(
  candidate: MockCandidateName,
  opts: { phaseOf?: MockSimulationPlan["phaseOf"]; analysis?: AnalysisAdapter } = {},
): Pick<ControllerDeps, "simulation" | "analysis" | "candidates"> {
  return {
    simulation: createMockSimulation({ baseline: "batch.baseline.json", candidate: MOCK_CANDIDATES[candidate], phaseOf: opts.phaseOf }),
    analysis: opts.analysis ?? createMockAnalysis([], 0.05),
    candidates: createMockCandidates(),
  };
}
