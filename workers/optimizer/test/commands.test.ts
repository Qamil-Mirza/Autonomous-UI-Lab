import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DesignFeedbackPacket,
  Evaluation,
  ExperimentProtocol,
  ObservationTrend,
  type CandidateDesign,
  type ExperimentProtocolDraft,
  type MutationPatch,
} from "@ghostloop/contracts";
import { loadFixture } from "@ghostloop/contracts/fixtures";
import { z } from "zod";
import { createCommands } from "../src/commands";
import { InMemoryStore } from "../src/store";

const NOW = "2026-10-24T10:00:00.000Z";
const base = "ver_base0001";
const fixtureProtocol = loadFixture("protocol.default.json", ExperimentProtocol);
const { id: _id, frozenAt: _f, experimentId: _e, ...draft } = fixtureProtocol;
const protocolDraft: ExperimentProtocolDraft = draft;
const templatePatch = loadFixture("feedback-packet.json", DesignFeedbackPacket).patches[0]!;
const accepted = loadFixture("evaluation.accepted.json", Evaluation);
const inconclusive = loadFixture("evaluation.inconclusive.json", Evaluation);
const rejected = loadFixture("evaluation.rejected.json", Evaluation);
const fixtureObservation = loadFixture("observations.json", z.array(ObservationTrend))[0]!;

const createPayload = { protocol: protocolDraft, baseVersionUrl: "http://localhost:4100/v/ver_base0001", baseManifestHash: "sha256:base" };

function patch(id: string, experimentId: string, over: Partial<MutationPatch> = {}): MutationPatch {
  return { ...templatePatch, id, experimentId, round: 1, sourceVersionId: base, state: "proposed", ...over } as MutationPatch;
}

let store: InMemoryStore;
let runtime: { launch: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> };
let cmd: ReturnType<typeof createCommands>;
let experimentId: string;
let ok: { experimentId: string; sourceVersionId: string; round: number; patchIds: string[]; approvedBy: string };

async function newExperiment(): Promise<string> {
  const r = await cmd.createExperiment(createPayload);
  if (!r.ok) throw new Error(r.message);
  return r.value.experimentId;
}

async function park(id: string): Promise<void> {
  const exp = (await store.getExperiment(id))!;
  await store.putExperiment({ ...exp, state: "awaiting_approval", startedAt: NOW });
}

beforeEach(async () => {
  store = new InMemoryStore();
  runtime = { launch: vi.fn(), cancel: vi.fn() };
  cmd = createCommands(store, runtime, () => NOW);
  experimentId = await newExperiment();
  await park(experimentId);
  await store.putPatches([
    patch("pat_a", experimentId),
    patch("pat_b", experimentId),
    patch("pat_blocked", experimentId, { state: "blocked", risk: "blocked", blockReason: "protected" }),
  ]);
  const other = await newExperiment();
  await store.putPatches([patch("pat_from_other_exp", other)]);
  ok = { experimentId, sourceVersionId: base, round: 1, patchIds: ["pat_a"], approvedBy: "designer" };
});

describe("createExperiment", () => {
  it("freezes the protocol and inserts the base version", async () => {
    const exp = (await store.getExperiment(experimentId))!;
    expect(exp.id).toMatch(/^exp_/);
    expect(exp.protocol.id).toMatch(/^proto_/);
    expect(exp.protocol.experimentId).toBe(experimentId);
    expect(exp.protocol.frozenAt).toBe(NOW);
    expect(exp.incumbentVersionId).toBe(base);
    expect(exp.round).toEqual({ index: 1, analysisAttempts: 0 });
    expect(exp.transitions).toEqual([]);
    expect(exp.usage).toEqual({ inferenceCalls: 0, inferenceUsd: 0, wallClockMs: 0 });
    expect(exp.cancelRequested).toBe(false);
    expect(await store.getVersion(base)).toEqual({
      schemaVersion: "1.0.0", id: base, parentVersionId: null, patchIds: [],
      url: createPayload.baseVersionUrl, manifestHash: "sha256:base", createdAt: NOW,
    });
  });

  it("starts in created and reuses an existing base version", async () => {
    // beforeEach already created two experiments on the same base version without throwing
    const r = await cmd.createExperiment(createPayload);
    expect(r.ok).toBe(true);
    if (r.ok) expect((await store.getExperiment(r.value.experimentId))!.state).toBe("created");
  });

  it("returns VALIDATION_FAILED for a bad payload", async () => {
    expect(await cmd.createExperiment({ protocol: {}, baseVersionUrl: "nope" })).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(await cmd.createExperiment(undefined)).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
  });
});

describe("startExperiment", () => {
  it("only starts from created, sets startedAt and launches", async () => {
    const id = await newExperiment();
    const r = await cmd.startExperiment({ experimentId: id });
    expect(r).toEqual({ ok: true, value: { experimentId: id } });
    expect((await store.getExperiment(id))!.startedAt).toBe(NOW);
    expect(runtime.launch).toHaveBeenCalledWith(id);
    expect(await cmd.startExperiment({ experimentId })).toMatchObject({ ok: false, code: "INVALID_STATE" });
  });

  it("NOT_FOUND and VALIDATION_FAILED", async () => {
    expect(await cmd.startExperiment({ experimentId: "exp_missing" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await cmd.startExperiment({ experimentId: "nope" })).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
  });
});

describe("cancelExperiment", () => {
  it("cancels a parked experiment and relaunches the driver to record the stop", async () => {
    const r = await cmd.cancelExperiment({ experimentId, reason: "done" });
    expect(r).toEqual({ ok: true, value: { experimentId } });
    expect((await store.getExperiment(experimentId))!.cancelRequested).toBe(true);
    expect(runtime.cancel).toHaveBeenCalledWith(experimentId);
    expect(runtime.launch).toHaveBeenCalledWith(experimentId);
  });

  it("allows cancelling a parked accepted experiment with no stopping record", async () => {
    const exp = (await store.getExperiment(experimentId))!;
    await store.putExperiment({ ...exp, state: "accepted" });
    expect((await cmd.cancelExperiment({ experimentId })).ok).toBe(true);
  });

  it("rejects a terminal experiment", async () => {
    const exp = (await store.getExperiment(experimentId))!;
    await store.putExperiment({ ...exp, state: "stopped" });
    expect(await cmd.cancelExperiment({ experimentId })).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(runtime.cancel).not.toHaveBeenCalled();
    expect(await cmd.cancelExperiment({ experimentId: "exp_missing" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("approvePatches", () => {
  it("approves only selected patches", async () => {
    const r = await cmd.approvePatches({ experimentId, sourceVersionId: base, round: 1, patchIds: ["pat_a"], approvedBy: "designer" });
    expect(r.ok).toBe(true);
    expect((await store.getPatch("pat_a"))!.state).toBe("approved");
    expect((await store.getPatch("pat_b"))!.state).toBe("declined");
    expect((await store.getPatch("pat_blocked"))!.state).toBe("blocked");
    expect((await store.getPatch("pat_from_other_exp"))!.state).toBe("proposed");
    const approval = (await store.getApproval(experimentId, 1))!;
    expect(approval).toMatchObject({ experimentId, round: 1, sourceVersionId: base, patchIds: ["pat_a"], approvedBy: "designer", at: NOW });
    expect(approval.id).toMatch(/^appr_/);
    expect((await store.getExperiment(experimentId))!.round.approvalId).toBe(approval.id);
    expect(runtime.launch).toHaveBeenCalledWith(experimentId);
  });

  it("accepts an empty approval (designer declines all)", async () => {
    expect((await cmd.approvePatches({ ...ok, patchIds: [] })).ok).toBe(true);
    expect((await store.getPatch("pat_a"))!.state).toBe("declined");
    expect((await store.getPatch("pat_b"))!.state).toBe("declined");
  });

  it("rejects stale source version", async () => {
    expect(await cmd.approvePatches({ ...ok, sourceVersionId: "ver_other" })).toMatchObject({ ok: false, code: "STALE_SOURCE_VERSION" });
  });

  it("rejects a round mismatch as stale", async () => {
    expect(await cmd.approvePatches({ ...ok, round: 2 })).toMatchObject({ ok: false, code: "STALE_SOURCE_VERSION" });
  });

  it("rejects second approval", async () => {
    await cmd.approvePatches(ok);
    expect(await cmd.approvePatches(ok)).toMatchObject({ ok: false, code: "ALREADY_APPROVED" });
  });

  it("rejects patch from another round or experiment", async () => {
    expect(await cmd.approvePatches({ ...ok, patchIds: ["pat_from_other_exp"] })).toMatchObject({ ok: false, code: "UNKNOWN_PATCH" });
    expect(await store.getApproval(experimentId, 1)).toBeUndefined();
    await store.putPatches([patch("pat_round2", experimentId, { round: 2 })]);
    expect(await cmd.approvePatches({ ...ok, patchIds: ["pat_round2"] })).toMatchObject({ ok: false, code: "UNKNOWN_PATCH" });
    expect(await cmd.approvePatches({ ...ok, patchIds: ["pat_nonexistent"] })).toMatchObject({ ok: false, code: "UNKNOWN_PATCH" });
  });

  it("rejects blocked patch", async () => {
    expect(await cmd.approvePatches({ ...ok, patchIds: ["pat_blocked"] })).toMatchObject({ ok: false, code: "PATCH_BLOCKED" });
    expect(await store.getApproval(experimentId, 1)).toBeUndefined();
    expect((await store.getPatch("pat_a"))!.state).toBe("proposed");
  });

  it("rejects when not awaiting approval or cancel was requested", async () => {
    const exp = (await store.getExperiment(experimentId))!;
    await store.putExperiment({ ...exp, cancelRequested: true });
    expect(await cmd.approvePatches(ok)).toMatchObject({ ok: false, code: "INVALID_STATE" });
    await store.putExperiment({ ...exp, state: "patching" });
    expect(await cmd.approvePatches(ok)).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(runtime.launch).not.toHaveBeenCalled();
  });

  it("NOT_FOUND and VALIDATION_FAILED", async () => {
    expect(await cmd.approvePatches({ ...ok, experimentId: "exp_missing" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await cmd.approvePatches({ ...ok, patchIds: ["a"] })).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(await cmd.approvePatches({ ...ok, approvedBy: "" })).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
  });
});

describe("recordFinalReview", () => {
  const acceptedCand = "cand_acc";
  const inconclusiveCand = "cand_inc";
  const rejectedCand = "cand_rej";
  const noEvalCand = "cand_noeval";
  const acceptedCandVersion = "ver_candacc";

  function cand(id: string, versionId: string, evaluationId?: string): CandidateDesign {
    return {
      schemaVersion: "1.0.0", id: id as CandidateDesign["id"], versionId: versionId as CandidateDesign["versionId"],
      parentVersionId: base, patchIds: ["pat_a"], url: `http://localhost:4100/v/${versionId}`,
      reviewStatus: "pending", ...(evaluationId ? { evaluationId: evaluationId as CandidateDesign["evaluationId"] } : {}),
      createdAt: NOW,
    };
  }

  beforeEach(async () => {
    const own = { experimentId: experimentId as Evaluation["experimentId"] };
    await store.putEvaluation({ ...accepted, ...own, id: "eval_acc", candidateVersionId: acceptedCandVersion });
    await store.putEvaluation({ ...inconclusive, ...own, id: "eval_inc" });
    await store.putEvaluation({ ...rejected, ...own, id: "eval_rej" });
    await store.putCandidate(experimentId, cand(acceptedCand, acceptedCandVersion, "eval_acc"));
    await store.putCandidate(experimentId, cand(inconclusiveCand, "ver_candinc", "eval_inc"));
    await store.putCandidate(experimentId, cand(rejectedCand, "ver_candrej", "eval_rej"));
    await store.putCandidate(experimentId, cand(noEvalCand, "ver_candnoe"));
  });

  it("promotion requires accepted evaluation", async () => {
    expect(await cmd.recordFinalReview({ experimentId, candidateId: inconclusiveCand, status: "promoted_measured" })).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(await cmd.recordFinalReview({ experimentId, candidateId: noEvalCand, status: "promoted_measured" })).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect((await store.getExperiment(experimentId))!.incumbentVersionId).toBe(base);
    const r = await cmd.recordFinalReview({ experimentId, candidateId: acceptedCand, status: "promoted_measured" });
    expect(r.ok).toBe(true);
    expect((await store.getExperiment(experimentId))!.incumbentVersionId).toBe(acceptedCandVersion);
    expect((await store.getCandidate(acceptedCand))!.reviewStatus).toBe("promoted_measured");
  });

  it("promotion after a stop moves stopping.bestVersionId to the promoted candidate", async () => {
    expect((await cmd.cancelExperiment({ experimentId })).ok).toBe(true);
    const exp = (await store.getExperiment(experimentId))!;
    // What the driver records for the cancel: a USER_STOP naming the (old) incumbent as best.
    await store.putExperiment({
      ...exp,
      state: "stopped",
      stopping: { reason: "USER_STOP", at: NOW, bestVersionId: base, attemptedCandidateIds: [], evaluationIds: [], rejectedPatchIds: [], remainingObservationIds: [] },
    });
    const r = await cmd.recordFinalReview({ experimentId, candidateId: acceptedCand, status: "promoted_measured" });
    expect(r.ok).toBe(true);
    const after = (await store.getExperiment(experimentId))!;
    expect(after.incumbentVersionId).toBe(acceptedCandVersion);
    expect(after.stopping!.bestVersionId).toBe(acceptedCandVersion);
    expect(after.stopping!.reason).toBe("USER_STOP");
  });

  it("aesthetic retention leaves incumbent", async () => {
    const r = await cmd.recordFinalReview({ experimentId, candidateId: inconclusiveCand, status: "retained_aesthetic" });
    expect(r.ok).toBe(true);
    expect((await store.getCandidate(inconclusiveCand))!.reviewStatus).toBe("retained_aesthetic");
    expect((await store.getExperiment(experimentId))!.incumbentVersionId).toBe(base);
  });

  it("aesthetic retention requires passed guardrails", async () => {
    expect(await cmd.recordFinalReview({ experimentId, candidateId: rejectedCand, status: "retained_aesthetic" })).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(await cmd.recordFinalReview({ experimentId, candidateId: noEvalCand, status: "retained_aesthetic" })).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect((await store.getCandidate(rejectedCand))!.reviewStatus).toBe("pending");
  });

  it("discard is always allowed and leaves incumbent", async () => {
    expect((await cmd.recordFinalReview({ experimentId, candidateId: rejectedCand, status: "discarded" })).ok).toBe(true);
    expect((await store.getCandidate(rejectedCand))!.reviewStatus).toBe("discarded");
    expect((await store.getExperiment(experimentId))!.incumbentVersionId).toBe(base);
  });

  it("a second final review is ALREADY_APPROVED", async () => {
    await cmd.recordFinalReview({ experimentId, candidateId: acceptedCand, status: "discarded" });
    expect(await cmd.recordFinalReview({ experimentId, candidateId: acceptedCand, status: "promoted_measured" })).toMatchObject({ ok: false, code: "ALREADY_APPROVED" });
    expect((await store.getExperiment(experimentId))!.incumbentVersionId).toBe(base);
  });

  it("rejects promotion of a candidate built on a stale incumbent", async () => {
    const exp = (await store.getExperiment(experimentId))!;
    await store.putExperiment({ ...exp, incumbentVersionId: "ver_moved" });
    expect(await cmd.recordFinalReview({ experimentId, candidateId: acceptedCand, status: "promoted_measured" })).toMatchObject({ ok: false, code: "STALE_SOURCE_VERSION" });
  });

  it("candidate must belong to the experiment", async () => {
    const other = await newExperiment();
    expect(await cmd.recordFinalReview({ experimentId: other, candidateId: acceptedCand, status: "discarded" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await cmd.recordFinalReview({ experimentId, candidateId: "cand_missing", status: "discarded" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await cmd.recordFinalReview({ experimentId: "exp_missing", candidateId: acceptedCand, status: "discarded" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("a candidate with no patches and no evaluation is still owned and can be discarded", async () => {
    const bare = { ...cand("cand_bare", "ver_candbare"), patchIds: [] };
    await store.putCandidate(experimentId, bare);
    expect((await store.listCandidates(experimentId)).map((c) => c.id)).toContain("cand_bare");
    expect((await cmd.recordFinalReview({ experimentId, candidateId: "cand_bare", status: "discarded" })).ok).toBe(true);
    expect((await store.getCandidate("cand_bare"))!.reviewStatus).toBe("discarded");
  });

  it("promotion requires the accepted evaluation to measure this candidate in this experiment", async () => {
    await store.putEvaluation({ ...accepted, experimentId: experimentId as Evaluation["experimentId"], id: "eval_wrongver", candidateVersionId: "ver_someoneelse" });
    await store.putCandidate(experimentId, cand("cand_wrongver", "ver_candwv", "eval_wrongver"));
    expect(await cmd.recordFinalReview({ experimentId, candidateId: "cand_wrongver", status: "promoted_measured" })).toMatchObject({ ok: false, code: "INVALID_STATE" });
    await store.putEvaluation({ ...accepted, id: "eval_foreign", candidateVersionId: "ver_candfx" }); // experimentId exp_demo0001
    await store.putCandidate(experimentId, cand("cand_foreignev", "ver_candfx", "eval_foreign"));
    expect(await cmd.recordFinalReview({ experimentId, candidateId: "cand_foreignev", status: "promoted_measured" })).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect((await store.getExperiment(experimentId))!.incumbentVersionId).toBe(base);
  });

  it("rejects status pending", async () => {
    expect(await cmd.recordFinalReview({ experimentId, candidateId: acceptedCand, status: "pending" })).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
  });
});

describe("setObservationDisposition", () => {
  it("writes the disposition by fingerprint and updates the observation", async () => {
    const obs = { ...fixtureObservation, experimentId: experimentId as ObservationTrend["experimentId"], id: "obs_mine" as const };
    await store.putObservations([obs]);
    const r = await cmd.setObservationDisposition({ experimentId, observationId: "obs_mine", disposition: "intentional" });
    expect(r.ok).toBe(true);
    expect((await store.getDispositions()).get(obs.fingerprint)).toBe("intentional");
    expect((await store.getObservation("obs_mine"))!.disposition).toBe("intentional");
  });

  it("NOT_FOUND for a missing or foreign observation", async () => {
    expect(await cmd.setObservationDisposition({ experimentId, observationId: "obs_missing", disposition: "confirmed" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    await store.putObservations([fixtureObservation]); // belongs to exp_demo0001
    expect(await cmd.setObservationDisposition({ experimentId, observationId: fixtureObservation.id, disposition: "confirmed" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect((await store.getDispositions()).size).toBe(0);
  });

  it("VALIDATION_FAILED for an unknown disposition", async () => {
    expect(await cmd.setObservationDisposition({ experimentId, observationId: "obs_x", disposition: "great" })).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
  });
});
