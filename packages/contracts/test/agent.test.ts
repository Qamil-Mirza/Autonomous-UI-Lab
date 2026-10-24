import { describe, it, expect } from "vitest";
import { AgentRunResult, AgentActionEvent, PublicAgentInput, isBehaviorallyValid } from "../src/agent";
import { BatchRequest, BatchResult } from "../src/simulation";

const event = (seq: number, runId = "run_1") => ({
  runId, seq, at: "2026-10-23T00:00:00.000Z", versionId: "ver_1", screenBefore: "plan", screenAfter: "plan",
  action: { type: "click", elementId: "btn" }, result: "ok", viewport: { width: 1280, height: 800 },
});
const makeRun = (o: Record<string, unknown> = {}) => ({
  schemaVersion: "1.0.0", runId: "run_1", experimentId: "exp_1", protocolId: "proto_1", versionId: "ver_1",
  scenarioId: "scn_1", batchId: "batch_1", events: [event(0), event(1)], goalVerified: true, stepCount: 2,
  outcome: "goal", terminalScreen: "done", screenshots: [], behaviorallyValid: true,
  startedAt: "2026-10-23T00:00:00.000Z", endedAt: "2026-10-23T00:00:05.000Z", ...o,
});
const validInput = {
  runId: "run_1", task: "Sign up", scenario: { description: "d", inputs: { a: "b" } },
  screenshot: { uri: "file:///x.png", width: 10, height: 10 },
  controls: [{ elementId: "e", role: "button", label: "Go", enabled: true }],
  previousActions: [], remainingActions: 5,
};

describe("agent schemas", () => {
  it("accepts a valid run", () => {
    expect(AgentRunResult.safeParse(makeRun()).success).toBe(true);
  });
  it("rejects self-reported goal without checker verification", () => {
    expect(AgentRunResult.safeParse(makeRun({ outcome: "goal", goalVerified: false })).success).toBe(false);
  });
  it("rejects verified goal with non-goal outcome", () => {
    expect(AgentRunResult.safeParse(makeRun({ outcome: "agent_stop", goalVerified: true })).success).toBe(false);
  });
  it("requires behaviorallyValid to match outcome", () => {
    expect(AgentRunResult.safeParse(makeRun({ outcome: "model_error", goalVerified: false, behaviorallyValid: true })).success).toBe(false);
    expect(AgentRunResult.safeParse(makeRun({ outcome: "model_error", goalVerified: false, behaviorallyValid: false })).success).toBe(true);
  });
  it("rejects events with foreign runId or duplicate seq", () => {
    expect(AgentRunResult.safeParse(makeRun({ events: [event(0, "run_2")] })).success).toBe(false);
    expect(AgentRunResult.safeParse(makeRun({ events: [event(0), event(0)] })).success).toBe(false);
  });
  it("isBehaviorallyValid", () => {
    expect(isBehaviorallyValid("flow_blocked")).toBe(true);
    expect(isBehaviorallyValid("browser_error")).toBe(false);
    expect(isBehaviorallyValid("user_cancelled")).toBe(false);
  });
  it("public agent input refuses hidden fields", () => {
    expect(PublicAgentInput.safeParse(validInput).success).toBe(true);
    expect(PublicAgentInput.safeParse({ ...validInput, hiddenGoalRef: "x" }).success).toBe(false);
    expect(PublicAgentInput.safeParse({ ...validInput, allowedPaths: ["plan"] }).success).toBe(false);
  });
  it("event pointer is optional, never defaulted", () => {
    const e = AgentActionEvent.parse(event(0));
    expect(e.pointer).toBeUndefined();
    expect("pointer" in e).toBe(false);
  });
  it("batch request/result parse", () => {
    const req = {
      batchId: "batch_1", experimentId: "exp_1", protocolId: "proto_1", versionId: "ver_1", versionUrl: "http://localhost:1", task: "t",
      scenarios: [{ id: "scn_1", name: "n", description: "d", inputs: {}, runs: 2 }],
      runsPerBatch: 2, maxActionsPerRun: 10, maxConcurrency: 2, hiddenGoalRef: "goal",
    };
    expect(BatchRequest.safeParse(req).success).toBe(true);
    const { experimentId: _omit, ...noExp } = req;
    expect(BatchRequest.safeParse(noExp).success).toBe(false);
    const res = { schemaVersion: "1.0.0", batchId: "batch_1", versionId: "ver_1", runs: [makeRun()], usage: { inferenceCalls: 1, inferenceUsd: 0.1, wallClockMs: 10 }, cancelled: false, plannedRuns: 2 };
    expect(BatchResult.safeParse(res).success).toBe(true);
    expect(BatchResult.safeParse({ ...res, plannedRuns: 0 }).success).toBe(false);
  });
});
