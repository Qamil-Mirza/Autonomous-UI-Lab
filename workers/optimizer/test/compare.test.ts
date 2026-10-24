import { describe, expect, it } from "vitest";
import { BatchResult, ExperimentProtocol } from "@ghostloop/contracts";
import { loadFixture } from "@ghostloop/contracts/fixtures";
import { compare, computeMetrics, stoppingReasonFor } from "../src/evaluator";

const protocol = loadFixture("protocol.default.json", ExperimentProtocol);
const { scenarios, policy } = protocol;

function metricsFrom(file: string) {
  const b = loadFixture(file, BatchResult);
  return computeMetrics({ versionId: b.versionId, batchId: b.batchId, runs: b.runs, plannedRuns: b.plannedRuns, scenarios, policy });
}

const base = metricsFrom("batch.baseline.json");
const improved = metricsFrom("batch.candidate-improved.json");
const flat = metricsFrom("batch.candidate-flat.json");
const zeroValid = metricsFrom("batch.zero-valid.json");
const underfilled = metricsFrom("batch.underfilled.json");

describe("compare", () => {
  it("failed guardrail rejects regardless of rate", () => {
    const r = compare(base, improved, [{ name: "protected", passed: false }], policy);
    expect(r.decision).toBe("rejected");
    expect(r.reasons.length).toBeGreaterThan(0);
  });
  it("failed guardrail wins with null candidate", () => {
    const r = compare(base, null, [{ name: "protected", passed: false }], policy);
    expect(r.decision).toBe("rejected");
    expect(r.deltaPp).toBeNull();
  });
  it("null candidate without failed guardrail is inconclusive", () => {
    const r = compare(base, null, [], policy);
    expect(r.decision).toBe("inconclusive");
    expect(r.reasons.length).toBeGreaterThan(0);
  });
  it("+25pp accepts", () => {
    const r = compare(base, improved, [], policy);
    expect(r.decision).toBe("accepted");
    expect(r.deltaPp).toBe(25);
    expect(r.reasons.length).toBeGreaterThan(0);
  });
  it("+8.3pp is inconclusive", () => {
    const r = compare(base, flat, [], policy);
    expect(r.decision).toBe("inconclusive");
    expect(r.deltaPp).toBe(8.3);
  });
  it("decides on the raw delta: +9.97pp (reported 10.0) is inconclusive at a 10pp margin", () => {
    expect(base.completionRate).toBe(0.5);
    const up = compare(base, { ...flat, completionRate: 0.5997 }, [], policy);
    expect(up.deltaPp).toBe(10);
    expect(up.decision).toBe("inconclusive");
    const down = compare(base, { ...flat, completionRate: 0.4003 }, [], policy);
    expect(down.deltaPp).toBe(-10);
    expect(down.decision).toBe("inconclusive");
    // Exactly +/-10pp still meets the margin despite float error ((0.6 - 0.5) * 100 is 9.999…98).
    expect(compare(base, { ...flat, completionRate: 0.6 }, [], policy).decision).toBe("accepted");
    expect(compare(base, { ...flat, completionRate: 0.4 }, [], policy).decision).toBe("rejected");
  });
  it("zero-valid or underfilled candidate is inconclusive", () => {
    expect(compare(base, zeroValid, [], policy).decision).toBe("inconclusive");
    expect(compare(base, underfilled, [], policy).decision).toBe("inconclusive");
  });
  it("complete but null rate is inconclusive", () => {
    const r = compare(base, { ...zeroValid, complete: true }, [], policy);
    expect(r.decision).toBe("inconclusive");
    expect(r.deltaPp).toBeNull();
  });
  it("incomplete baseline is inconclusive", () => {
    expect(compare(underfilled, improved, [], policy).decision).toBe("inconclusive");
  });
  it("secondary regression rejects even with rate gain", () => {
    const r = compare(base, { ...improved, medianActionsToSuccess: base.medianActionsToSuccess! + 3 }, [], policy);
    expect(r.decision).toBe("rejected");
  });
  it("validation-error rate regression rejects", () => {
    const r = compare(base, { ...improved, validationErrorRuns: improved.validRuns }, [], policy);
    expect(r.decision).toBe("rejected");
  });
  it("large drop rejects", () => {
    expect(compare(improved, base, [], policy).decision).toBe("rejected");
  });
});

describe("stoppingReasonFor", () => {
  it("stopping reasons", () => {
    expect(stoppingReasonFor("accepted", 0.9, { ...policy, targetCompletionRate: 0.8 }, 1, 3)).toBe("TARGET_MET");
    expect(stoppingReasonFor("accepted", 0.75, { ...policy, targetCompletionRate: 0.8 }, 3, 3)).toBe("ITERATION_BUDGET");
    expect(stoppingReasonFor("accepted", 0.75, { ...policy, targetCompletionRate: 0.8 }, 1, 3)).toBeNull();
    expect(stoppingReasonFor("rejected", 0.4, policy, 1, 3)).toBe("NO_MEASURED_IMPROVEMENT");
    expect(stoppingReasonFor("inconclusive", null, policy, 1, 3)).toBe("INCONCLUSIVE");
  });
});
