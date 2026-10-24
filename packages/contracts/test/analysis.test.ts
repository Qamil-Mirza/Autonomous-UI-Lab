import { describe, it, expect } from "vitest";
import {
  MutationPatch, RawFeedbackProposal, Hypothesis, ObservationTrend, DesignFeedbackPacket,
  RunMetrics, ScenarioMetrics, Evaluation, Experiment, CandidateDesign, ValidationResult, ObservationKind,
} from "../src/index";

const basePatch = {
  schemaVersion: "1.0.0", id: "pat_1", experimentId: "exp_1", round: 1, sourceVersionId: "ver_1",
  targetElementId: "plan.free.cta", observationIds: ["obs_1"], rationale: "r", risk: "low", state: "proposed",
};
const rawPatch = { targetElementId: "plan.free.cta", op: "set_label", value: "Start free", observationIds: ["obs_1"], rationale: "r" };
const hyp = { schemaVersion: "1.0.0", id: "hyp_1", observationIds: ["obs_1"], statement: "s", label: "hypothesis" };
const outcomeCounts = { goal: 1, agent_stop: 0, step_limit: 0, flow_blocked: 0, model_error: 0, browser_error: 0, user_cancelled: 0 };
const metrics = {
  versionId: "ver_1", batchId: "batch_1", plannedRuns: 12, validRuns: 12, successes: 6, completionRate: 0.5, outcomeCounts,
  infraErrors: 0, cancelled: false, medianActionsToSuccess: 4, backtrackRuns: 5, validationErrorRuns: 1, perScenario: [], complete: true,
};

describe("analysis schemas", () => {
  it("patch value type follows op", () => {
    expect(MutationPatch.safeParse({ ...basePatch, op: "set_order", value: "first" }).success).toBe(false);
    expect(MutationPatch.safeParse({ ...basePatch, op: "set_order", value: 2 }).success).toBe(true);
    expect(MutationPatch.safeParse({ ...basePatch, op: "set_order", value: -1 }).success).toBe(false);
    expect(MutationPatch.safeParse({ ...basePatch, op: "set_visibility", value: false }).success).toBe(true);
    expect(MutationPatch.safeParse({ ...basePatch, op: "set_label", value: false }).success).toBe(false);
  });
  it("raw proposal cannot carry ids, source version or risk", () => {
    expect(RawFeedbackProposal.strict().safeParse({ hypotheses: [], patches: [{ ...rawPatch, risk: "low" }] }).success).toBe(false);
    expect(RawFeedbackProposal.strict().safeParse({ hypotheses: [], patches: [{ ...rawPatch, sourceVersionId: "ver_1" }] }).success).toBe(false);
    expect(RawFeedbackProposal.strict().safeParse({ hypotheses: [], patches: [{ ...rawPatch, id: "pat_1" }] }).success).toBe(false);
    expect(RawFeedbackProposal.strict().safeParse({ hypotheses: [], patches: [rawPatch] }).success).toBe(true);
    expect(RawFeedbackProposal.safeParse({ hypotheses: [], patches: [{ ...rawPatch, op: "set_order", value: "x" }] }).success).toBe(false);
  });
  it("hypothesis must be labeled", () => {
    expect(Hypothesis.safeParse({ ...hyp, label: "fact" }).success).toBe(false);
    expect(Hypothesis.safeParse(hyp).success).toBe(true);
  });
  it("observation kinds", () => {
    expect(ObservationKind.options).toEqual(["outcome_count", "screen_revisit", "repeated_failed_action", "validation_error", "step_limit"]);
    const o = { schemaVersion: "1.0.0", id: "obs_1", experimentId: "exp_1", versionId: "ver_1", batchId: "batch_1", kind: "screen_revisit", statement: "s", numerator: 5, denominator: 12, traceRefs: [{ runId: "run_1", seq: 2 }], screens: ["plan"], elementIds: [], disposition: "unreviewed", fingerprint: "f" };
    expect(ObservationTrend.safeParse(o).success).toBe(true);
    expect(ObservationTrend.safeParse({ ...o, kind: "nope" }).success).toBe(false);
  });
  it("packet parses", () => {
    const p = { schemaVersion: "1.0.0", id: "pkt_1", experimentId: "exp_1", versionId: "ver_1", task: "t", intentConstraints: [], observations: [{ id: "obs_1", statement: "s" }], traceEvidence: [{ runId: "run_1" }], hypotheses: [hyp], patches: [{ ...basePatch, op: "set_label", value: "x" }], protectedConstraints: [], reviewPolicy: "manual_required", createdAt: "2026-10-23T00:00:00Z" };
    expect(DesignFeedbackPacket.safeParse(p).success).toBe(true);
  });
});

describe("evaluation/candidate/experiment schemas", () => {
  it("metrics allow null rate", () => {
    expect(RunMetrics.shape.completionRate.safeParse(null).success).toBe(true);
    expect(RunMetrics.shape.medianActionsToSuccess.safeParse(null).success).toBe(true);
    expect(RunMetrics.safeParse(metrics).success).toBe(true);
    expect(ScenarioMetrics.safeParse({ scenarioId: "scn_1", plannedRuns: 3, validRuns: 0, successes: 0, completionRate: null, outcomeCounts, medianActionsToSuccess: null, complete: false }).success).toBe(true);
  });
  it("evaluation allows null candidate and deltaPp", () => {
    const e = { schemaVersion: "1.0.0", id: "eval_1", experimentId: "exp_1", protocolId: "proto_1", baselineVersionId: "ver_1", candidateVersionId: "ver_2", baseline: metrics, candidate: null, guardrails: [{ name: "g", passed: false }], deltaPp: null, decision: "rejected", reasons: ["x"], at: "2026-10-23T00:00:00Z" };
    expect(Evaluation.safeParse(e).success).toBe(true);
  });
  it("candidate and validation parse", () => {
    expect(CandidateDesign.safeParse({ schemaVersion: "1.0.0", id: "cand_1", versionId: "ver_2", parentVersionId: "ver_1", patchIds: ["pat_1"], url: "http://x/y", reviewStatus: "pending", createdAt: "2026-10-23T00:00:00Z", figma: { frameUrl: "http://f", status: "verified", manifestHash: "h", patchIds: [] } }).success).toBe(true);
    expect(ValidationResult.safeParse({ schemaVersion: "1.0.0", candidateId: "cand_1", ok: true, checks: [{ name: "build", kind: "runnable", passed: true }], at: "2026-10-23T00:00:00Z" }).success).toBe(true);
  });
  it("experiment parses", () => {
    const x = { schemaVersion: "1.0.0", id: "exp_1", protocol: undefined, state: "created", incumbentVersionId: "ver_1", round: { index: 0, analysisAttempts: 0 }, transitions: [], usage: { inferenceCalls: 0, inferenceUsd: 0, wallClockMs: 0 }, cancelRequested: false };
    expect(Experiment.safeParse(x).success).toBe(false); // protocol required
    expect(Experiment.shape).toHaveProperty("stopping");
  });
});
