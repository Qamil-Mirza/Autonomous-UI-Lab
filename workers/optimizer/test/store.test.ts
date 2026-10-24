import { beforeEach, describe, expect, it } from "vitest";
import {
  AgentRunResult,
  CandidateDesign,
  DesignFeedbackPacket,
  Evaluation,
  ObservationTrend,
  type AgentActionEvent,
  type DesignVersion,
} from "@ghostloop/contracts";
import { loadFixture } from "@ghostloop/contracts/fixtures";
import { z } from "zod";
import { InMemoryStore } from "../src/store";

const goalRun = loadFixture("runs/goal.json", AgentRunResult);
const packet = loadFixture("feedback-packet.json", DesignFeedbackPacket);
const observations = loadFixture("observations.json", z.array(ObservationTrend));
const candidate = loadFixture("candidate.json", CandidateDesign);
const evaluation = loadFixture("evaluation.accepted.json", Evaluation);

const e = (seq: number, runId = "run_a"): AgentActionEvent => ({
  runId: runId as AgentActionEvent["runId"],
  seq,
  at: "2026-10-23T09:00:00.000Z",
  versionId: "ver_base0001",
  screenBefore: "signup",
  screenAfter: "signup",
  action: { type: "click", elementId: "signup.submit" },
  result: "ok",
  viewport: { width: 1280, height: 800 },
});

const v: DesignVersion = {
  schemaVersion: "1.0.0",
  id: "ver_base0001",
  parentVersionId: null,
  patchIds: [],
  url: "http://localhost:4100/v/ver_base0001",
  manifestHash: "sha256:base",
  createdAt: "2026-10-23T09:00:00.000Z",
};

let s: InMemoryStore;
beforeEach(() => {
  s = new InMemoryStore();
});

describe("InMemoryStore", () => {
  it("dedupes actions by run+seq", async () => {
    expect(await s.insertAction(e(0))).toBe(true);
    expect(await s.insertAction(e(0))).toBe(false);
    expect((await s.listActions("run_a")).length).toBe(1);
  });

  it("lists actions in seq order, scoped to the run", async () => {
    await s.insertAction(e(2));
    await s.insertAction(e(0));
    await s.insertAction(e(1));
    await s.insertAction(e(0, "run_b"));
    expect((await s.listActions("run_a")).map((x) => x.seq)).toEqual([0, 1, 2]);
  });

  it("versions are immutable", async () => {
    await s.insertVersion(v);
    await expect(s.insertVersion(v)).rejects.toThrow();
    expect(await s.getVersion(v.id)).toEqual(v);
  });

  it("returns clones, not live references", async () => {
    await s.insertVersion(v);
    const got = (await s.getVersion(v.id))!;
    got.url = "http://evil.example/";
    expect((await s.getVersion(v.id))!.url).toBe(v.url);
  });

  it("listRuns rebuilds events from the actions table and putRun is idempotent", async () => {
    const run = { ...goalRun, events: goalRun.events.slice(0, 2) };
    await s.putRun(run);
    await s.putRun(run);
    // events streamed separately after the run record are still visible
    for (const ev of goalRun.events) await s.insertAction(ev);
    const runs = await s.listRuns(goalRun.batchId);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.events.map((x) => x.seq)).toEqual(goalRun.events.map((x) => x.seq));
    expect(await s.listRuns("batch_other")).toEqual([]);
  });

  it("stores observations and dispositions keyed by fingerprint", async () => {
    await s.putObservations(observations);
    const expId = observations[0]!.experimentId;
    expect(await s.listObservations(expId)).toHaveLength(observations.length);
    expect(await s.listObservations("exp_none")).toEqual([]);
    expect(await s.getObservation(observations[0]!.id)).toEqual(observations[0]);
    await s.setDisposition("fp|a", "intentional");
    const d = await s.getDispositions();
    expect(d.get("fp|a")).toBe("intentional");
  });

  it("lists patches by experiment and round, and updates a patch", async () => {
    await s.putPatches(packet.patches);
    const p0 = packet.patches[0]!;
    expect(await s.listPatches(p0.experimentId, 1)).toHaveLength(packet.patches.length);
    expect(await s.listPatches(p0.experimentId, 2)).toEqual([]);
    await s.updatePatch(p0.id, { state: "approved" });
    expect((await s.getPatch(p0.id))!.state).toBe("approved");
    await expect(s.updatePatch("pat_missing", { state: "approved" })).rejects.toThrow();
  });

  it("stores approvals by experiment and round", async () => {
    const a = {
      schemaVersion: "1.0.0" as const,
      id: "appr_1" as const,
      experimentId: "exp_x" as const,
      round: 1,
      sourceVersionId: "ver_base0001" as const,
      patchIds: [],
      approvedBy: "designer",
      at: "2026-10-23T09:00:00.000Z",
    };
    await s.putApproval(a);
    expect(await s.getApproval("exp_x", 1)).toEqual(a);
    expect(await s.getApproval("exp_x", 2)).toBeUndefined();
  });

  it("lists candidates and evaluations by experiment", async () => {
    await s.putPatches(packet.patches);
    await s.putCandidate(candidate);
    await s.putEvaluation(evaluation);
    expect(await s.getCandidate(candidate.id)).toEqual(candidate);
    expect((await s.listCandidates("exp_demo0001")).map((c) => c.id)).toEqual([candidate.id]);
    expect(await s.listCandidates("exp_other")).toEqual([]);
    expect(await s.getEvaluation(evaluation.id)).toEqual(evaluation);
    expect((await s.listEvaluations("exp_demo0001")).map((x) => x.id)).toEqual([evaluation.id]);
  });

  it("onChange fires (table, key) after writes and can unsubscribe", async () => {
    const seen: string[] = [];
    const off = s.onChange((t, k) => seen.push(`${t}:${k}`));
    await s.insertVersion(v);
    await s.insertAction(e(0));
    await s.insertAction(e(0)); // duplicate: no write, no event
    await s.putPacket(packet);
    await s.setDisposition("fp|a", "confirmed");
    off();
    await s.insertAction(e(1));
    expect(seen).toEqual([
      "design_versions:ver_base0001",
      "agent_actions:run_a:0",
      `packets:${packet.id}`,
      "dispositions:fp|a",
    ]);
  });
});
