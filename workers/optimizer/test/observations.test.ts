import { describe, expect, it } from "vitest";
import { BatchResult, ObservationTrend, type AgentRunResult } from "@ghostloop/contracts";
import { loadFixture } from "@ghostloop/contracts/fixtures";
import { aggregateObservations, isSuppressed } from "../src/observations";
import { isBacktrackRun, revisitedScreens } from "../src/evaluator";

function fromFixture(file: string) {
  const b = loadFixture(file, BatchResult);
  return { experimentId: b.runs[0]!.experimentId, versionId: b.versionId, batchId: b.batchId, runs: b.runs };
}

const args = { ...fromFixture("batch.baseline.json"), dispositions: new Map() };

describe("revisitedScreens", () => {
  it("is the per-screen form of isBacktrackRun", () => {
    for (const r of args.runs) {
      const s = revisitedScreens(r.events);
      expect(s.size > 0).toBe(isBacktrackRun(r.events));
    }
  });
  it("finds plan and compare in the step-limit run", () => {
    const r = args.runs.find((x) => x.outcome === "step_limit")!;
    expect([...revisitedScreens(r.events)].sort()).toEqual(["compare", "plan"]);
  });
});

describe("aggregateObservations", () => {
  it("counts plan revisits neutrally", () => {
    const obs = aggregateObservations({ ...fromFixture("batch.baseline.json"), dispositions: new Map() });
    const o = obs.find((x) => x.kind === "screen_revisit" && x.screens.includes("plan"))!;
    expect(o.statement).toBe("5 of 12 runs revisited plan");
    expect(o.traceRefs.length).toBe(5);
    expect(o.numerator).toBe(5);
    expect(o.denominator).toBe(12);
    expect(o.fingerprint).toBe("screen_revisit|plan");
    expect(o.traceRefs.every((t) => typeof t.seq === "number")).toBe(true);
  });

  it("carries prior dispositions by fingerprint", () => {
    const first = aggregateObservations({ ...args, dispositions: new Map() });
    const fp = first[0]!.fingerprint;
    const again = aggregateObservations({ ...args, dispositions: new Map([[fp, "intentional" as const]]) });
    expect(isSuppressed(again.find((o) => o.fingerprint === fp)!)).toBe(true);
    expect(again.filter((o) => o.fingerprint !== fp).every((o) => o.disposition === "unreviewed" && !isSuppressed(o))).toBe(true);
  });

  it("isSuppressed only for intentional and not_relevant", () => {
    const o = aggregateObservations(args)[0]!;
    expect(isSuppressed({ ...o, disposition: "intentional" })).toBe(true);
    expect(isSuppressed({ ...o, disposition: "not_relevant" })).toBe(true);
    expect(isSuppressed({ ...o, disposition: "confirmed" })).toBe(false);
    expect(isSuppressed({ ...o, disposition: "unreviewed" })).toBe(false);
  });

  it("emits the expected baseline findings, all schema-valid and neutral", () => {
    const obs = aggregateObservations(args);
    const byFp = new Map(obs.map((o) => [o.fingerprint, o]));
    expect([...byFp.keys()]).toEqual([
      "outcome_count",
      "screen_revisit|compare",
      "screen_revisit|plan",
      "repeated_failed_action|signup|signup.submit",
      "validation_error|invite|invite.email",
      "step_limit",
    ]);
    expect(byFp.get("outcome_count")!.statement).toBe("6 of 12 valid runs reached the goal; 0 infrastructure errors; 0 cancelled");
    expect(byFp.get("screen_revisit|compare")!.statement).toBe("1 of 12 runs revisited compare");
    expect(byFp.get("repeated_failed_action|signup|signup.submit")!.statement).toBe(
      "1 of 12 runs repeated a failed action on signup.submit",
    );
    expect(byFp.get("validation_error|invite|invite.email")!.statement).toBe("1 of 12 runs hit a validation error on invite.email");
    expect(byFp.get("step_limit")!.statement).toBe("1 of 12 runs reached the step limit");
    for (const o of obs) {
      expect(ObservationTrend.parse(o)).toEqual(o);
      expect(o.id.startsWith("obs_")).toBe(true);
      expect(o.statement).not.toMatch(/confus|because|frustrat|struggl/i);
      expect(o.numerator).toBeGreaterThanOrEqual(1);
    }
    expect(new Set(obs.map((o) => o.id)).size).toBe(obs.length);
  });

  it("outcome_count states infra and cancel separately; behavioral kinds use valid runs only", () => {
    const obs = aggregateObservations({ ...fromFixture("batch.metrics-4-4-2-1.json"), dispositions: new Map() });
    const oc = obs.find((o) => o.kind === "outcome_count")!;
    expect(oc.statement).toBe("4 of 8 valid runs reached the goal; 2 infrastructure errors; 1 cancelled");
    expect(oc.numerator).toBe(4);
    expect(oc.denominator).toBe(8);
    for (const o of obs.filter((x) => x.kind !== "outcome_count")) expect(o.denominator).toBe(8);
  });

  it("ignores infra runs for behavioral kinds", () => {
    const base = fromFixture("batch.baseline.json");
    const revisit = base.runs.find((r) => r.runId === "run_base_07")!;
    const infra: AgentRunResult = { ...revisit, runId: "run_infra_x", outcome: "browser_error", goalVerified: false, behaviorallyValid: false,
      events: revisit.events.map((e) => ({ ...e, runId: "run_infra_x" })) };
    const obs = aggregateObservations({ ...base, runs: [...base.runs, infra], dispositions: new Map() });
    expect(obs.find((o) => o.fingerprint === "screen_revisit|plan")!.statement).toBe("5 of 12 runs revisited plan");
    expect(obs.find((o) => o.kind === "outcome_count")!.statement).toBe(
      "6 of 12 valid runs reached the goal; 1 infrastructure errors; 0 cancelled",
    );
  });

  it("zero-valid batch yields only the outcome summary", () => {
    const obs = aggregateObservations({ ...fromFixture("batch.zero-valid.json"), dispositions: new Map() });
    expect(obs.map((o) => o.kind)).toEqual(["outcome_count"]);
    expect(obs[0]!.statement).toBe("0 of 0 valid runs reached the goal; 12 infrastructure errors; 0 cancelled");
  });

  it("ignores scripted scenario steps, counting only the model's own actions", () => {
    const scripted = args.runs.map((r) => ({
      ...r,
      events: r.events.map((e) => (e.result === "validation_error" ? { ...e, decisionSource: "scenario" as const } : e)),
    }));
    const fps = aggregateObservations({ ...args, runs: scripted }).map((o) => o.fingerprint);
    expect(fps).not.toContain("validation_error|invite|invite.email");
    expect(aggregateObservations(args).map((o) => o.fingerprint)).toContain("validation_error|invite|invite.email");
  });

  it("duplicate runs and events do not change counts", () => {
    const dupRuns = [...args.runs, args.runs[6]!].map((r, i) => (i === 6 ? { ...r, events: [...r.events, ...r.events] } : r));
    const strip = (os: ObservationTrend[]) => os.map(({ id: _id, ...rest }) => rest);
    expect(strip(aggregateObservations({ ...args, runs: dupRuns }))).toEqual(strip(aggregateObservations(args)));
  });
});
