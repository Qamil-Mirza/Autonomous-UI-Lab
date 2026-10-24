import { describe, it, expect } from "vitest";
import { CreateExperiment, ApprovePatches, RecordFinalReview, CommandErrorCode, SetObservationDisposition } from "../src/index";

const draft = { schemaVersion: "1.0.0", baseVersionId: "ver_1", task: "t", hiddenGoalRef: "goal_1", allowedPaths: ["plan"], intentConstraints: [], protectedElements: [], protectedCategories: [], approvedStyleTokens: [], mode: "manual", scenarios: [{ id: "scn_a", name: "n", description: "d", inputs: {}, runs: 3 }], budgets: { maxActionsPerRun: 8, runsPerBatch: 12, maxConcurrency: 4, maxIterations: 3, maxCandidates: 3, maxInferenceUsd: 5, maxWallClockMs: 1800000 }, policy: { targetCompletionRate: 0.8 } };

describe("commands", () => {
  it("final review cannot set pending", () => {
    expect(RecordFinalReview.safeParse({ experimentId: "exp_1", candidateId: "cand_1", status: "pending" }).success).toBe(false);
    expect(RecordFinalReview.safeParse({ experimentId: "exp_1", candidateId: "cand_1", status: "promoted_measured" }).success).toBe(true);
  });
  it("approve allows empty patch list", () => {
    expect(ApprovePatches.safeParse({ experimentId: "exp_1", sourceVersionId: "ver_1", round: 1, patchIds: [], approvedBy: "me" }).success).toBe(true);
  });
  it("create experiment requires base version info", () => {
    expect(CreateExperiment.safeParse({ protocol: {} }).success).toBe(false);
    const ok = { protocol: draft, baseVersionUrl: "http://localhost:3000/v1", baseManifestHash: "h" };
    expect(CreateExperiment.safeParse(ok).success).toBe(true);
    expect(CreateExperiment.safeParse({ protocol: draft, baseManifestHash: "h" }).success).toBe(false);
    expect(CreateExperiment.safeParse({ protocol: draft, baseVersionUrl: "http://localhost:3000/v1" }).success).toBe(false);
    expect(CreateExperiment.shape).toHaveProperty("baseVersionUrl");
    expect(CreateExperiment.shape).toHaveProperty("baseManifestHash");
  });
  it("error codes", () => {
    expect(CommandErrorCode.options).toEqual(["NOT_FOUND", "INVALID_STATE", "STALE_SOURCE_VERSION", "ALREADY_APPROVED", "UNKNOWN_PATCH", "PATCH_BLOCKED", "VALIDATION_FAILED"]);
    expect(SetObservationDisposition.safeParse({ experimentId: "exp_1", observationId: "obs_1", disposition: "confirmed" }).success).toBe(true);
  });
});
