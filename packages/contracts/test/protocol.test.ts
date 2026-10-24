import { describe, it, expect } from "vitest";
import { EvaluationPolicy, ExperimentProtocol, ExperimentProtocolDraft, Scenario, Budgets } from "../src/protocol";
import { ManifestElement, DesignManifest } from "../src/manifest";
import { HiddenGoalSpec } from "../src/hidden";

describe("protocol schemas", () => {
  it("applies policy defaults", () => {
    const p = EvaluationPolicy.parse({ targetCompletionRate: 0.8 });
    expect(p).toMatchObject({ minImprovementPp: 10, maxMedianActionsIncrease: 2, maxValidationErrorRateIncreasePp: 15, minValidFraction: 0.75, minValidPerScenario: 1 });
  });
  it("rejects target outside 0..1", () => {
    expect(EvaluationPolicy.safeParse({ targetCompletionRate: 1.5 }).success).toBe(false);
    expect(EvaluationPolicy.safeParse({}).success).toBe(false);
  });
  it("rejects negative margins and regression limits", () => {
    for (const k of ["minImprovementPp", "maxMedianActionsIncrease", "maxValidationErrorRateIncreasePp"]) {
      expect(EvaluationPolicy.safeParse({ targetCompletionRate: 0.8, [k]: -1 }).success).toBe(false);
      expect(EvaluationPolicy.safeParse({ targetCompletionRate: 0.8, [k]: 0 }).success).toBe(true);
    }
  });
  it("protocol does not carry hidden goal description", () => {
    expect(Object.keys(ExperimentProtocol.shape)).not.toContain("hiddenGoal");
    expect(ExperimentProtocol.shape).toHaveProperty("hiddenGoalRef");
  });
  it("draft omits id, experimentId and frozenAt", () => {
    const keys = Object.keys(ExperimentProtocolDraft.shape);
    for (const k of ["id", "experimentId", "frozenAt"]) expect(keys).not.toContain(k);
    expect(keys).toContain("baseVersionId");
  });
  it("scenario requires positive int runs and string inputs", () => {
    const s = { id: "scn_a", name: "n", description: "d", inputs: { email: "a@b.c" }, runs: 3 };
    expect(Scenario.safeParse(s).success).toBe(true);
    expect(Scenario.safeParse({ ...s, runs: 0 }).success).toBe(false);
    expect(Scenario.safeParse({ ...s, inputs: { a: 1 } }).success).toBe(false);
  });
  it("budgets parse", () => {
    expect(Budgets.safeParse({ maxActionsPerRun: 8, runsPerBatch: 12, maxConcurrency: 4, maxIterations: 3, maxCandidates: 3, maxInferenceUsd: 5, maxWallClockMs: 1800000 }).success).toBe(true);
  });
  it("hidden goal spec parses", () => {
    expect(HiddenGoalSpec.safeParse({ ref: "goal_1", description: "x", checkerId: "c1" }).success).toBe(true);
  });
  it("index does not export HiddenGoalSpec", async () => {
    const idx = await import("../src/index");
    expect("HiddenGoalSpec" in idx).toBe(false);
    expect("ExperimentProtocol" in idx).toBe(true);
    expect("DesignManifest" in idx).toBe(true);
  });
  it("manifest element categories are protected categories", () => {
    expect(ManifestElement.safeParse({ elementId: "plan.free.cta", screen: "plan", role: "button", protected: false, categories: ["bogus"], supportedOps: ["set_label"] }).success).toBe(false);
    expect(ManifestElement.safeParse({ elementId: "plan.free.cta", screen: "plan", role: "button", protected: false, categories: ["pricing"], supportedOps: ["set_label"] }).success).toBe(true);
  });
  it("design manifest parses", () => {
    expect(DesignManifest.safeParse({ schemaVersion: "1.0.0", versionId: "ver_a", manifestHash: "h", elements: [] }).success).toBe(true);
  });
  it("design manifest rejects duplicate elementIds", () => {
    const el = { elementId: "plan.free.cta", screen: "plan", role: "button", protected: false, categories: [], supportedOps: ["set_label"] };
    const base = { schemaVersion: "1.0.0", versionId: "ver_a", manifestHash: "h" };
    expect(DesignManifest.safeParse({ ...base, elements: [el, { ...el, elementId: "plan.pro.cta" }] }).success).toBe(true);
    const dup = DesignManifest.safeParse({ ...base, elements: [el, { ...el, protected: true }] });
    expect(dup.success).toBe(false);
    if (!dup.success) {
      expect(dup.error.issues[0]?.message).toMatch(/duplicate elementId "plan.free.cta"/);
      expect(dup.error.issues[0]?.path).toEqual(["elements", 1, "elementId"]);
    }
  });
});
