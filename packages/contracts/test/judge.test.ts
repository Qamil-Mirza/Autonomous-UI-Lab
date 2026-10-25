import { describe, expect, it } from "vitest";
import {
  AgentRunResult,
  BatchResult,
  DEFAULT_VETO_RULES,
  ExperimentProtocol,
  ExperimentProtocolDraft,
  JudgeRecord,
  JudgeVerdict,
} from "../src";
import { loadFixture } from "../fixtures";

describe("judge contracts", () => {
  it("accepts an uncertain verdict and rejects anything else", () => {
    expect(JudgeVerdict.parse({ reached: "uncertain", explanation: "final screen unclear", evidence: [] }).reached).toBe("uncertain");
    expect(JudgeVerdict.safeParse({ reached: "maybe", explanation: "x", evidence: [] }).success).toBe(false);
    expect(JudgeVerdict.safeParse({ reached: true, explanation: "", evidence: [] }).success).toBe(false);
  });

  it("keeps a judge record and protected violation on a run", () => {
    const base = loadFixture("runs/goal.json", AgentRunResult);
    const judge = JudgeRecord.parse({ reached: false, explanation: "No dashboard page exists.", evidence: ["step 11"], model: "claude-opus-5-5", instructionVersion: "judge-v1", usd: 0.03 });
    const run = AgentRunResult.parse({ ...base, outcome: "flow_blocked", goalVerified: false, behaviorallyValid: true, judge, protectedViolation: "no_paid_trial" });
    expect(run.judge).toEqual(judge);
    expect(run.protectedViolation).toBe("no_paid_trial");
  });

  it("leaves existing fixtures valid", () => {
    expect(() => loadFixture("runs/goal.json", AgentRunResult)).not.toThrow();
    expect(() => loadFixture("batch.baseline.json", BatchResult)).not.toThrow();
    expect(() => loadFixture("protocol.default.json", ExperimentProtocol)).not.toThrow();
  });

  it("lets a protocol carry veto rules, defaulting to no paid trial", () => {
    const { id: _i, frozenAt: _f, experimentId: _e, ...draft } = loadFixture("protocol.default.json", ExperimentProtocol);
    expect(ExperimentProtocolDraft.parse({ ...draft, vetoRules: ["no_paid_trial"] }).vetoRules).toEqual(["no_paid_trial"]);
    expect(DEFAULT_VETO_RULES).toEqual(["no_paid_trial"]);
  });

  it("records which judge scored a batch", () => {
    const b = loadFixture("batch.baseline.json", BatchResult);
    expect(BatchResult.parse({ ...b, judge: { model: "claude-opus-5-5", instructionVersion: "judge-v1" } }).judge?.model).toBe("claude-opus-5-5");
  });
});
