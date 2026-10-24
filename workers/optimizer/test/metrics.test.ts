import { describe, expect, it } from "vitest";
import { BatchResult, ExperimentProtocol, RunMetrics, type AgentRunResult } from "@ghostloop/contracts";
import { loadFixture } from "@ghostloop/contracts/fixtures";
import { computeMetrics, dedupeEvents, isBacktrackRun } from "../src/evaluator";

const protocol = loadFixture("protocol.default.json", ExperimentProtocol);
const { scenarios, policy } = protocol;

function argsFor(file: string) {
  const b = loadFixture(file, BatchResult);
  return { versionId: b.versionId, batchId: b.batchId, runs: b.runs, plannedRuns: b.plannedRuns, scenarios, policy };
}

describe("computeMetrics", () => {
  it("4 goal / 4 behavioral / 2 infra / 1 cancel -> 4/8", () => {
    const m = computeMetrics(argsFor("batch.metrics-4-4-2-1.json"));
    expect(m.successes).toBe(4);
    expect(m.validRuns).toBe(8);
    expect(m.completionRate).toBe(0.5);
    expect(m.infraErrors).toBe(2);
    expect(m.cancelled).toBe(1);
    expect(m.complete).toBe(false); // 8 < ceil(0.75 * 12) = 9
    expect(m.incompleteReason).toBeTruthy();
    expect(RunMetrics.parse(m)).toEqual(m);
    expect(Object.values(m.outcomeCounts).reduce((a, b) => a + b, 0)).toBe(11);
  });

  it("baseline exact values", () => {
    const m = computeMetrics(argsFor("batch.baseline.json"));
    expect(m.validRuns).toBe(12);
    expect(m.successes).toBe(6);
    expect(m.medianActionsToSuccess).toBe(7.5);
    expect(m.backtrackRuns).toBe(5);
    expect(m.validationErrorRuns).toBe(1);
    expect(m.complete).toBe(true);
    expect(m.incompleteReason).toBeUndefined();
    expect(m.perScenario).toHaveLength(scenarios.length);
    expect(RunMetrics.parse(m)).toEqual(m);
  });

  it("duplicate runs and events do not change metrics", () => {
    const args = argsFor("batch.baseline.json");
    const dup = [...args.runs, args.runs[0]!].map((r, i) => (i === 0 ? { ...r, events: [...r.events, ...r.events] } : r));
    expect(computeMetrics({ ...args, runs: dup })).toEqual(computeMetrics(args));
  });

  it("zero valid runs -> null rate, not 0", () => {
    const m = computeMetrics(argsFor("batch.zero-valid.json"));
    expect(m.completionRate).toBeNull();
    expect(m.medianActionsToSuccess).toBeNull();
    expect(m.complete).toBe(false);
    expect(m.infraErrors).toBe(12);
    expect(RunMetrics.parse(m)).toEqual(m);
  });

  it("underfilled batch is incomplete", () => {
    const m = computeMetrics(argsFor("batch.underfilled.json"));
    expect(m.complete).toBe(false);
    expect(m.incompleteReason).toBeTruthy();
  });

  it("median of even count averages middles", () => {
    const args = argsFor("batch.baseline.json");
    const goals = args.runs.filter((r) => r.outcome === "goal");
    const withSteps = (r: AgentRunResult, n: number): AgentRunResult => ({ ...r, events: r.events.slice(0, n) });
    const runs = [withSteps(goals[0]!, 4), withSteps(goals[1]!, 6)];
    expect(computeMetrics({ ...args, runs }).medianActionsToSuccess).toBe(5);
  });
});

describe("dedupeEvents / isBacktrackRun", () => {
  const goal = argsFor("batch.baseline.json").runs.find((r) => r.outcome === "goal")!;
  it("first wins and sorted by seq", () => {
    const [e0, e1] = goal.events;
    const out = dedupeEvents([e1!, e0!, { ...e0!, screenAfter: "zzz" }]);
    expect(out.map((e) => e.seq)).toEqual([e0!.seq, e1!.seq]);
    expect(out[0]).toBe(e0);
  });
  it("detects return to a left screen", () => {
    const mk = (seq: number, before: string, after: string) => ({ ...goal.events[0]!, seq, screenBefore: before, screenAfter: after });
    expect(isBacktrackRun([mk(0, "plan", "compare"), mk(1, "compare", "plan"), mk(2, "plan", "invite")])).toBe(true);
    expect(isBacktrackRun([mk(0, "plan", "compare"), mk(1, "compare", "plan")])).toBe(false);
    expect(isBacktrackRun([mk(0, "a", "b"), mk(1, "b", "c")])).toBe(false);
    expect(isBacktrackRun([mk(0, "a", "a"), mk(1, "a", "a")])).toBe(false);
  });
  it("out-of-order duplicate events dedupe and sort", () => {
    const e = (seq: number) => ({ ...goal.events[0]!, seq });
    const ev = dedupeEvents([e(3), e(2), e(2), e(0), e(1)]);
    expect(ev.map((x) => x.seq)).toEqual([0, 1, 2, 3]);
  });
});
