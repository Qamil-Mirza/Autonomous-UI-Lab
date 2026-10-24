import { describe, it, expect } from "vitest";
import { CreateExperiment, ApprovePatches, RecordFinalReview, CommandErrorCode, SetObservationDisposition } from "../src/index";

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
    expect(CreateExperiment.shape).toHaveProperty("baseVersionUrl");
    expect(CreateExperiment.shape).toHaveProperty("baseManifestHash");
  });
  it("error codes", () => {
    expect(CommandErrorCode.options).toEqual(["NOT_FOUND", "INVALID_STATE", "STALE_SOURCE_VERSION", "ALREADY_APPROVED", "UNKNOWN_PATCH", "PATCH_BLOCKED", "VALIDATION_FAILED"]);
    expect(SetObservationDisposition.safeParse({ experimentId: "exp_1", observationId: "obs_1", disposition: "confirmed" }).success).toBe(true);
  });
});
