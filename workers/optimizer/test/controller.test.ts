import { describe, expect, it } from "vitest";
import {
  BatchResult,
  DesignManifest,
  ExperimentProtocol,
  SCHEMA_VERSION,
  type CandidateDesign,
  type Experiment,
  type ExperimentProtocolDraft,
} from "@ghostloop/contracts";
import { loadFixture } from "@ghostloop/contracts/fixtures";
import { createCommands } from "../src/commands";
import { ExperimentRuntime, type ControllerDeps } from "../src/controller";
import { createMockAnalysis } from "../src/mocks/analysis";
import { createMockCandidates } from "../src/mocks/candidates";
import { createMockSimulation } from "../src/mocks/simulation";
import { InMemoryStore } from "../src/store";

const NOW = "2026-10-24T10:00:00.000Z";
const T0 = Date.parse(NOW);
const BASE = "ver_base0001";
const fixtureProtocol = loadFixture("protocol.default.json", ExperimentProtocol);
const baseManifest = loadFixture("manifest.base.json", DesignManifest);
const { id: _id, frozenAt: _f, experimentId: _e, ...draft } = fixtureProtocol;

interface SetupOpts {
  candidate?: string;
  delayMs?: number;
  throwOn?: "baseline" | "candidate";
  validation?: "pass" | "fail_runnable" | "fail_guardrail";
  candidatesThrowOn?: "create" | "validate";
  analysis?: unknown[];
  analysisUsd?: number;
  budgets?: Partial<ExperimentProtocolDraft["budgets"]>;
  now?: () => number;
  start?: boolean;
}

async function setup(opts: SetupOpts = {}) {
  const store = new InMemoryStore();
  const simulation = createMockSimulation({
    baseline: "batch.baseline.json",
    candidate: opts.candidate ?? "batch.candidate-improved.json",
    ...(opts.delayMs !== undefined && { delayMs: opts.delayMs }),
    ...(opts.throwOn !== undefined && { throwOn: opts.throwOn }),
  });
  const analysis = createMockAnalysis(opts.analysis ?? [], opts.analysisUsd ?? 0.05);
  const candidates = createMockCandidates({
    ...(opts.validation !== undefined && { validation: opts.validation }),
    ...(opts.candidatesThrowOn !== undefined && { throwOn: opts.candidatesThrowOn }),
  });
  const deps: ControllerDeps = { store, simulation, analysis, candidates, clock: () => NOW, now: opts.now ?? (() => T0) };
  const runtime = new ExperimentRuntime(deps);
  const cmd = createCommands(store, runtime, () => NOW);
  const protocol: ExperimentProtocolDraft = { ...draft, budgets: { ...draft.budgets, ...opts.budgets } };
  const created = await cmd.createExperiment({
    protocol,
    baseVersionUrl: "http://localhost:5173/v/ver_base0001",
    baseManifestHash: baseManifest.manifestHash,
  });
  if (!created.ok) throw new Error(created.message);
  const id = created.value.experimentId;
  if (opts.start !== false) {
    const started = await cmd.startExperiment({ experimentId: id });
    if (!started.ok) throw new Error(started.message);
  }
  const exp = async (): Promise<Experiment> => (await store.getExperiment(id))!;
  const proposedPatches = async () => (await store.listPatches(id, 1)).filter((p) => p.state !== "blocked");
  const okApproval = () => ({ experimentId: id, sourceVersionId: BASE, round: 1, patchIds: [] as string[], approvedBy: "d" });
  const approveAll = async () => {
    const ids = (await proposedPatches()).map((p) => p.id);
    const r = await cmd.approvePatches({ ...okApproval(), patchIds: ids });
    if (!r.ok) throw new Error(r.message);
    await runtime.idle(id);
  };
  return { store, simulation, analysis, candidates, deps, runtime, cmd, id, base: BASE, exp, proposedPatches, okApproval, approveAll };
}

async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 1));
  if (!cond()) throw new Error("condition not reached");
}

const states = (e: Experiment) => e.transitions.map((x) => x.to);

describe("controller round on mocks", () => {
  it("parks at approval without creating a candidate", async () => {
    const t = await setup();
    await t.runtime.idle(t.id);
    const e = await t.exp();
    expect(e.state).toBe("awaiting_approval");
    expect(e.stopping).toBeUndefined();
    expect(t.candidates.created).toHaveLength(0);
    expect(t.analysis.calls).toHaveLength(1);
    const patches = await t.store.listPatches(t.id, 1);
    expect(patches.map((p) => [p.targetElementId, p.op, p.state])).toEqual([
      ["plan.free.cta", "set_label", "proposed"],
      ["plan.free.cta", "set_style_token", "proposed"],
      ["plan.pro.price", "set_label", "blocked"],
    ]);
    // Analysis input excludes protected elements; batch request uses the incumbent version URL.
    const input = t.analysis.calls[0]!;
    expect(input.editableElements.some((el) => el.elementId === "plan.pro.price")).toBe(false);
    expect(input.editableElements.some((el) => el.elementId === "plan.free.cta")).toBe(true);
    expect(t.simulation.calls[0]!.versionUrl).toBe("http://localhost:5173/v/ver_base0001");
    expect(t.simulation.calls[0]!.versionId).toBe(BASE);
  });

  it("full round: partial approval → candidate with only selected patches → accepted", async () => {
    const t = await setup({ candidate: "batch.candidate-improved.json" });
    await t.runtime.idle(t.id);
    const [label] = await t.proposedPatches();
    const r = await t.cmd.approvePatches({ experimentId: t.id, sourceVersionId: t.base, round: 1, patchIds: [label!.id], approvedBy: "d" });
    expect(r.ok).toBe(true);
    await t.runtime.idle(t.id);
    expect(t.candidates.created[0]).toEqual({ sourceVersionId: t.base, patchIds: [label!.id] });
    const e = await t.exp();
    expect(states(e)).toEqual([
      "baseline_running", "observing", "diagnosing", "proposing", "awaiting_approval",
      "patching", "validating", "candidate_running", "comparing", "accepted",
    ]);
    expect(e.state).toBe("accepted");
    expect(e.stopping).toBeUndefined();
    expect(e.incumbentVersionId).toBe(t.base); // promotion waits for final review
    const sims = t.simulation.calls;
    expect(sims).toHaveLength(2);
    expect(sims[0]!.batchId).not.toBe(sims[1]!.batchId); // fresh retest
    expect(sims[0]!.maxActionsPerRun).toBe(sims[1]!.maxActionsPerRun);
    expect(sims[0]!.scenarios).toEqual(sims[1]!.scenarios);

    // Candidate, version lineage, patch states, evaluation.
    const [cand] = await t.store.listCandidates(t.id);
    expect(cand!.patchIds).toEqual([label!.id]);
    expect(cand!.reviewStatus).toBe("pending");
    expect(sims[1]!.versionId).toBe(cand!.versionId);
    expect(sims[1]!.versionUrl).toBe(cand!.url);
    const version = await t.store.getVersion(cand!.versionId);
    expect(version).toMatchObject({ parentVersionId: t.base, patchIds: [label!.id], url: cand!.url });
    const patches = await t.store.listPatches(t.id, 1);
    expect(patches.map((p) => p.state)).toEqual(["applied", "declined", "blocked"]);
    const evaluation = await t.store.getEvaluation(cand!.evaluationId!);
    expect(evaluation).toMatchObject({ decision: "accepted", deltaPp: 25, baselineVersionId: t.base, candidateVersionId: cand!.versionId });
    expect(evaluation!.stoppingReason).toBeUndefined();
    expect(e.round.evaluationId).toBe(evaluation!.id);

    // Final review can now promote the measured winner.
    const review = await t.cmd.recordFinalReview({ experimentId: t.id, candidateId: cand!.id, status: "promoted_measured" });
    expect(review.ok).toBe(true);
    expect((await t.exp()).incumbentVersionId).toBe(cand!.versionId);
  });

  it("flat candidate → inconclusive, stopped, incumbent preserved", async () => {
    const t = await setup({ candidate: "batch.candidate-flat.json" });
    await t.runtime.idle(t.id);
    await t.approveAll();
    const e = await t.exp();
    expect(e.state).toBe("stopped");
    expect(states(e).slice(-3)).toEqual(["comparing", "inconclusive", "stopped"]);
    expect(e.stopping!.reason).toBe("INCONCLUSIVE");
    expect(e.incumbentVersionId).toBe(t.base);
    expect(e.stopping!.bestVersionId).toBe(t.base);
    expect(await t.store.getVersion(t.base)).toBeDefined();
    const [cand] = await t.store.listCandidates(t.id);
    expect(await t.store.getVersion(cand!.versionId)).toBeDefined(); // history preserved
    expect(e.stopping!.attemptedCandidateIds).toEqual([cand!.id]);
    expect(e.stopping!.evaluationIds).toHaveLength(1);
    const blocked = (await t.store.listPatches(t.id, 1)).find((p) => p.state === "blocked")!;
    expect(e.stopping!.rejectedPatchIds).toEqual([blocked.id]);
    const evaluation = await t.store.getEvaluation(e.stopping!.evaluationIds[0]!);
    expect(evaluation).toMatchObject({ decision: "inconclusive", deltaPp: 8.3, stoppingReason: "INCONCLUSIVE" });
  });

  it("guardrail failure → rejected, NO_VALID_PATCH, no retest", async () => {
    const t = await setup({ validation: "fail_guardrail" });
    await t.runtime.idle(t.id);
    await t.approveAll();
    const e = await t.exp();
    expect(e.state).toBe("stopped");
    expect(e.stopping!.reason).toBe("NO_VALID_PATCH");
    expect(states(e).slice(-3)).toEqual(["validating", "rejected", "stopped"]);
    expect(t.simulation.calls).toHaveLength(1);
    expect(e.incumbentVersionId).toBe(t.base);
    const [evaluation] = await t.store.listEvaluations(t.id);
    expect(evaluation).toMatchObject({ decision: "rejected", candidate: null, deltaPp: null, stoppingReason: "NO_VALID_PATCH" });
    expect(evaluation!.guardrails.some((g) => !g.passed)).toBe(true);
    const [cand] = await t.store.listCandidates(t.id);
    expect(cand!.evaluationId).toBe(evaluation!.id);
  });

  it("runnable failure → INTEGRATION_FAILURE", async () => {
    const t = await setup({ validation: "fail_runnable" });
    await t.runtime.idle(t.id);
    await t.approveAll();
    const e = await t.exp();
    expect(e.state).toBe("stopped");
    expect(e.stopping!.reason).toBe("INTEGRATION_FAILURE");
    expect(states(e).slice(-2)).toEqual(["validating", "stopped"]);
    expect(t.simulation.calls).toHaveLength(1);
    expect(await t.store.listEvaluations(t.id)).toHaveLength(0);
    expect(e.incumbentVersionId).toBe(t.base);
  });

  it("adapter throw → INTEGRATION_FAILURE", async () => {
    const t = await setup({ candidatesThrowOn: "create" });
    await t.runtime.idle(t.id);
    await t.approveAll();
    const e = await t.exp();
    expect(e.state).toBe("stopped");
    expect(e.stopping!.reason).toBe("INTEGRATION_FAILURE");
    expect(states(e).slice(-2)).toEqual(["patching", "stopped"]);
    expect(await t.store.listCandidates(t.id)).toHaveLength(0);
    expect(e.incumbentVersionId).toBe(t.base);
  });

  it("candidate getManifest throw → INTEGRATION_FAILURE (no Figma-hash fallback), incumbent preserved", async () => {
    const t = await setup();
    await t.runtime.idle(t.id);
    const orig = t.candidates.getManifest.bind(t.candidates);
    t.candidates.getManifest = async (v) => {
      if (v !== BASE) throw new Error("manifest service down");
      return orig(v);
    };
    // The candidate carries a Figma block, so the removed fallback to figma.manifestHash would have applied.
    const create = t.candidates.createCandidate.bind(t.candidates);
    t.candidates.createCandidate = async (src, patches) => ({
      ...(await create(src, patches)),
      figma: { frameUrl: "http://figma.test/frame", status: "verified", manifestHash: "sha256:figma", patchIds: patches.map((p) => p.id) },
    });
    await t.approveAll();
    const e = await t.exp();
    expect(e.stopping!.reason).toBe("INTEGRATION_FAILURE");
    expect(states(e).slice(-2)).toEqual(["patching", "stopped"]);
    expect(e.incumbentVersionId).toBe(t.base);
    expect(await t.store.listCandidates(t.id)).toHaveLength(0);
  });

  it("candidate getManifest for another version → INTEGRATION_FAILURE", async () => {
    const t = await setup();
    await t.runtime.idle(t.id);
    const orig = t.candidates.getManifest.bind(t.candidates);
    t.candidates.getManifest = async () => orig(BASE); // always answers with the base manifest
    await t.approveAll();
    const e = await t.exp();
    expect(e.stopping!.reason).toBe("INTEGRATION_FAILURE");
    expect(states(e).slice(-2)).toEqual(["patching", "stopped"]);
    expect(e.incumbentVersionId).toBe(t.base);
  });

  it("incumbent getManifest for another version → INTEGRATION_FAILURE without spending an analysis attempt", async () => {
    const t = await setup({ start: false });
    const orig = t.candidates.getManifest.bind(t.candidates);
    t.candidates.getManifest = async () => ({ ...(await orig(BASE)), versionId: "ver_other0001" as const });
    await t.cmd.startExperiment({ experimentId: t.id });
    await t.runtime.idle(t.id);
    const e = await t.exp();
    expect(e.stopping!.reason).toBe("INTEGRATION_FAILURE");
    expect(states(e).slice(-2)).toEqual(["proposing", "stopped"]);
    expect(e.round.analysisAttempts).toBe(0);
    expect(t.analysis.calls).toHaveLength(0);
  });

  it("batch request carries experimentId; stored runs are owned by the experiment", async () => {
    const t = await setup({ start: false });
    const orig = t.simulation.runBatch.bind(t.simulation);
    // B echoes the requested experimentId, except one run carries a foreign one: the controller overrides it.
    t.simulation.runBatch = async (req, onEvent, signal) => {
      const res = await orig(req, onEvent, signal);
      expect(res.runs.every((r) => r.experimentId === req.experimentId)).toBe(true);
      return { ...res, runs: res.runs.map((r, i) => (i === 0 ? { ...r, experimentId: "exp_foreign01" as const } : r)) };
    };
    await t.cmd.startExperiment({ experimentId: t.id });
    await t.runtime.idle(t.id);
    const e = await t.exp();
    expect(e.state).toBe("awaiting_approval");
    expect(t.simulation.calls[0]!.experimentId).toBe(t.id);
    const runs = await t.store.listRuns(e.round.baselineBatchId!);
    expect(runs).toHaveLength(12);
    expect(runs.every((r) => r.experimentId === t.id)).toBe(true);
  });

  it("malformed or wrong-version streamed events are skipped; the validated BatchResult copy is stored", async () => {
    const t = await setup({ start: false });
    const orig = t.simulation.runBatch.bind(t.simulation);
    let replaced = 0;
    t.simulation.runBatch = async (req, onEvent, signal) =>
      orig(
        req,
        (ev) => {
          if (ev.seq === 0 && replaced === 0) {
            replaced += 1;
            onEvent({ ...ev, seq: -1, screenAfter: "" } as typeof ev); // malformed: fails AgentActionEvent
            return; // the valid event for (runId, 0) is never streamed
          }
          if (ev.seq === 1 && replaced === 1) {
            replaced += 1;
            onEvent({ ...ev, versionId: "ver_other0001", screenAfter: "bogus" }); // schema-valid, wrong version
            return;
          }
          onEvent(ev);
        },
        signal,
      );
    await t.cmd.startExperiment({ experimentId: t.id });
    await t.runtime.idle(t.id);
    const e = await t.exp();
    expect(e.state).toBe("awaiting_approval");
    expect(replaced).toBe(2);
    const runs = await t.store.listRuns(e.round.baselineBatchId!);
    const fixture = loadFixture("batch.baseline.json", BatchResult);
    let stored = 0;
    for (const r of runs) {
      const actions = await t.store.listActions(r.runId);
      expect(actions.map((a) => a.seq)).toEqual(r.events.map((x) => x.seq));
      expect(actions.every((a) => a.versionId === BASE && a.seq >= 0 && a.screenAfter !== "bogus" && a.screenAfter !== "")).toBe(true);
      stored += actions.length;
    }
    expect(stored).toBe(fixture.runs.reduce((n, r) => n + r.events.length, 0));
  });

  it("simulation throw on baseline → INTEGRATION_FAILURE, no analysis", async () => {
    const t = await setup({ throwOn: "baseline" });
    await t.runtime.idle(t.id);
    const e = await t.exp();
    expect(e.stopping!.reason).toBe("INTEGRATION_FAILURE");
    expect(t.analysis.calls).toHaveLength(0);
  });

  it("cancel mid-baseline → USER_STOP, no further adapter calls", async () => {
    const t = await setup({ delayMs: 50 });
    await until(() => t.simulation.calls.length === 1); // the baseline batch is in flight
    await t.cmd.cancelExperiment({ experimentId: t.id });
    await t.runtime.idle(t.id);
    const e = await t.exp();
    expect(e.state).toBe("stopped");
    expect(e.stopping!.reason).toBe("USER_STOP");
    expect(states(e)).toEqual(["baseline_running", "stopped"]);
    expect(t.analysis.calls).toHaveLength(0);
    expect(t.simulation.calls).toHaveLength(1);
    expect(t.candidates.created).toHaveLength(0);
    const batch = await t.store.getBatch(e.round.baselineBatchId!);
    expect(batch!.cancelled).toBe(true);
    expect((await t.store.listRuns(batch!.batchId)).length).toBeLessThan(12); // partial results kept
  });

  it("cancel while awaiting approval; later approval refused", async () => {
    const t = await setup();
    await t.runtime.idle(t.id);
    await t.cmd.cancelExperiment({ experimentId: t.id });
    await t.runtime.idle(t.id);
    const e = await t.exp();
    expect(e.stopping!.reason).toBe("USER_STOP");
    expect(e.stopping!.bestVersionId).toBe(t.base);
    expect(e.stopping!.remainingObservationIds.length).toBeGreaterThan(0);
    const ids = (await t.proposedPatches()).map((p) => p.id);
    expect(await t.cmd.approvePatches({ ...t.okApproval(), patchIds: ids })).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(t.candidates.created).toHaveLength(0);
  });

  it("cancel of a parked accepted round writes USER_STOP", async () => {
    const t = await setup();
    await t.runtime.idle(t.id);
    await t.approveAll();
    expect((await t.exp()).state).toBe("accepted");
    await t.cmd.cancelExperiment({ experimentId: t.id });
    await t.runtime.idle(t.id);
    const e = await t.exp();
    expect(e.state).toBe("stopped");
    expect(e.stopping!.reason).toBe("USER_STOP");
    expect(e.incumbentVersionId).toBe(t.base);
    expect(e.stopping!.bestVersionId).toBe(t.base);
    // Promotion after the stop keeps the stopping record's best version in step with the incumbent.
    const [cand] = await t.store.listCandidates(t.id);
    const r = await t.cmd.recordFinalReview({ experimentId: t.id, candidateId: cand!.id, status: "promoted_measured" });
    expect(r.ok).toBe(true);
    const after = await t.exp();
    expect(after.incumbentVersionId).toBe(cand!.versionId);
    expect(after.stopping!.bestVersionId).toBe(cand!.versionId);
  });

  it("cost budget stops before proposing", async () => {
    // Baseline batch usage (0.336 USD) already exceeds 0.01, so the controller stops before any analysis call.
    const t = await setup({ budgets: { maxInferenceUsd: 0.01 } });
    await t.runtime.idle(t.id);
    const e = await t.exp();
    expect(e.state).toBe("stopped");
    expect(e.stopping!.reason).toBe("COST_BUDGET");
    expect(states(e)).toEqual(["baseline_running", "observing", "stopped"]);
    expect(t.analysis.calls).toHaveLength(0);
  });

  it("cost spent by the analysis call does not stop a parked round (R11), but stops it once approved", async () => {
    // 0.336 baseline + 0.1 analysis = 0.436 ≥ 0.4.
    const t = await setup({ budgets: { maxInferenceUsd: 0.4 }, analysisUsd: 0.1 });
    await t.runtime.idle(t.id);
    let e = await t.exp();
    expect(e.state).toBe("awaiting_approval");
    expect(e.usage.inferenceUsd).toBeCloseTo(0.436);
    await t.approveAll();
    e = await t.exp();
    expect(e.stopping!.reason).toBe("COST_BUDGET");
    expect(t.analysis.calls).toHaveLength(1);
    expect(t.candidates.created).toHaveLength(0);
  });

  it("cancel landing mid-patching starts no createCandidate call", async () => {
    const t = await setup();
    await t.runtime.idle(t.id);
    const orig = t.store.listPatches.bind(t.store);
    let fired = false;
    t.store.listPatches = async (experimentId, round) => {
      if (!fired && (await t.store.getExperiment(t.id))!.state === "patching") {
        fired = true;
        await t.cmd.cancelExperiment({ experimentId: t.id });
      }
      return orig(experimentId, round);
    };
    await t.approveAll();
    expect(fired).toBe(true);
    const e = await t.exp();
    expect(e.stopping!.reason).toBe("USER_STOP");
    expect(t.candidates.created).toHaveLength(0);
    expect(await t.store.listCandidates(t.id)).toHaveLength(0);
  });

  it("cancel landing mid-proposing starts no analysis call", async () => {
    const t = await setup({ start: false });
    const orig = t.store.listObservations.bind(t.store);
    let fired = false;
    t.store.listObservations = async (experimentId) => {
      if (!fired && (await t.store.getExperiment(t.id))!.state === "proposing") {
        fired = true;
        await t.cmd.cancelExperiment({ experimentId: t.id });
      }
      return orig(experimentId);
    };
    await t.cmd.startExperiment({ experimentId: t.id });
    await t.runtime.idle(t.id);
    expect(fired).toBe(true);
    const e = await t.exp();
    expect(e.stopping!.reason).toBe("USER_STOP");
    expect(t.analysis.calls).toHaveLength(0);
  });

  it("cancel landing between approve's guard and its write → approval refused, nothing stored", async () => {
    const t = await setup();
    await t.runtime.idle(t.id);
    const ids = (await t.proposedPatches()).map((p) => p.id);
    const orig = t.store.listPatches.bind(t.store);
    let fired = false;
    t.store.listPatches = async (experimentId, round) => {
      if (!fired) {
        fired = true; // approvePatches reads round patches after its guard, before writing
        await t.cmd.cancelExperiment({ experimentId: t.id });
      }
      return orig(experimentId, round);
    };
    const r = await t.cmd.approvePatches({ ...t.okApproval(), patchIds: ids });
    expect(r).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(await t.store.getApproval(t.id, 1)).toBeUndefined();
    expect((await orig(t.id, 1)).every((p) => p.state === "proposed" || p.state === "blocked")).toBe(true);
    await t.runtime.idle(t.id);
    const e = await t.exp();
    expect(e.round.approvalId).toBeUndefined();
    expect(e.stopping!.reason).toBe("USER_STOP");
    expect(t.candidates.created).toHaveLength(0);
  });

  it("two concurrent approvals → exactly one wins, the other ALREADY_APPROVED", async () => {
    const t = await setup();
    await t.runtime.idle(t.id);
    const [label, token] = await t.proposedPatches();
    const results = await Promise.all([
      t.cmd.approvePatches({ ...t.okApproval(), patchIds: [label!.id] }),
      t.cmd.approvePatches({ ...t.okApproval(), patchIds: [token!.id] }),
    ]);
    const oks = results.filter((r) => r.ok);
    const fails = results.filter((r) => !r.ok);
    expect(oks).toHaveLength(1);
    expect(fails).toMatchObject([{ ok: false, code: "ALREADY_APPROVED" }]);
    const winner = oks[0]! as { ok: true; value: { approvalId: string } };
    const stored = await t.store.getApproval(t.id, 1);
    expect(stored!.id).toBe(winner.value.approvalId);
    expect((await t.exp()).round.approvalId).toBe(stored!.id);
    await t.runtime.idle(t.id);
    expect((await t.exp()).state).toBe("accepted");
    expect(t.candidates.created).toEqual([{ sourceVersionId: BASE, patchIds: stored!.patchIds }]);
  });

  it("a drive step between the approval claim/patch writes and the Approval record does not lose the approval", async () => {
    const t = await setup();
    await t.runtime.idle(t.id);
    const [label] = await t.proposedPatches();
    const orig = t.store.updatePatch.bind(t.store);
    const midStates: string[] = [];
    t.store.updatePatch = async (id, changes) => {
      // Inside approvePatches: the round is claimed, patch states are being written, no Approval record yet.
      if (midStates.length === 0 && (await t.store.getExperiment(t.id))!.round.approvalId) {
        midStates.push((await t.runtime.drive(t.id)).state);
      }
      return orig(id, changes);
    };
    const r = await t.cmd.approvePatches({ ...t.okApproval(), patchIds: [label!.id] });
    expect(r.ok).toBe(true);
    expect(midStates).toEqual(["awaiting_approval"]); // the mid-write drive parked
    await t.runtime.idle(t.id);
    const e = await t.exp();
    expect(e.state).toBe("accepted");
    expect(t.candidates.created).toEqual([{ sourceVersionId: BASE, patchIds: [label!.id] }]);
  });

  it("patching selects patches by the stored Approval, not by patch state", async () => {
    const t = await setup();
    await t.runtime.idle(t.id);
    const [label, token] = await t.proposedPatches();
    // Approval record and claim exist, but patch states were never updated (still "proposed").
    await t.store.updateExperiment(t.id, (x) => ({ ...x, round: { ...x.round, approvalId: "appr_direct0001" } }));
    await t.store.putApproval({
      schemaVersion: SCHEMA_VERSION,
      id: "appr_direct0001",
      experimentId: t.id as `exp_${string}`,
      round: 1,
      sourceVersionId: BASE,
      patchIds: [label!.id],
      approvedBy: "d",
      at: NOW,
    });
    t.runtime.launch(t.id);
    await t.runtime.idle(t.id);
    expect((await t.exp()).state).toBe("accepted");
    expect(t.candidates.created).toEqual([{ sourceVersionId: BASE, patchIds: [label!.id] }]);
    expect((await t.store.getPatch(label!.id))!.state).toBe("applied");
    expect((await t.store.getPatch(token!.id))!.state).toBe("proposed");
  });

  it("approval re-check maps a mid-flight incumbent change to STALE_SOURCE_VERSION", async () => {
    const t = await setup();
    await t.runtime.idle(t.id);
    const ids = (await t.proposedPatches()).map((p) => p.id);
    const orig = t.store.listPatches.bind(t.store);
    let fired = false;
    t.store.listPatches = async (experimentId, round) => {
      if (!fired) {
        fired = true; // after approve's pre-guard, before its claim
        await t.store.updateExperiment(t.id, (x) => ({ ...x, incumbentVersionId: "ver_other0001" }));
      }
      return orig(experimentId, round);
    };
    const r = await t.cmd.approvePatches({ ...t.okApproval(), patchIds: ids });
    expect(r).toMatchObject({ ok: false, code: "STALE_SOURCE_VERSION" });
    expect(await t.store.getApproval(t.id, 1)).toBeUndefined();
    expect((await t.exp()).round.approvalId).toBeUndefined();
  });

  it("approval recorded against a non-incumbent source version is not applied", async () => {
    const t = await setup();
    await t.runtime.idle(t.id);
    const [label] = await t.proposedPatches();
    // A stale approval reaches the store directly (bypassing the command guard).
    await t.store.putApproval({
      schemaVersion: SCHEMA_VERSION,
      id: "appr_stale0001",
      experimentId: t.id as `exp_${string}`,
      round: 1,
      sourceVersionId: "ver_other0001",
      patchIds: [label!.id],
      approvedBy: "d",
      at: NOW,
    });
    await t.store.updatePatch(label!.id, { state: "approved" });
    await t.store.updateExperiment(t.id, (x) => ({ ...x, round: { ...x.round, approvalId: "appr_stale0001" } }));
    t.runtime.launch(t.id);
    await t.runtime.idle(t.id);
    const e = await t.exp();
    expect(e.stopping!.reason).toBe("NO_VALID_PATCH");
    expect(states(e).slice(-2)).toEqual(["patching", "stopped"]);
    expect(t.candidates.created).toHaveLength(0);
  });

  it("wall-clock budget → TIME_BUDGET", async () => {
    const t = await setup({ now: () => T0 + fixtureProtocol.budgets.maxWallClockMs });
    await t.runtime.idle(t.id);
    const e = await t.exp();
    expect(e.stopping!.reason).toBe("TIME_BUDGET");
    expect(t.simulation.calls).toHaveLength(0);
  });

  it("candidate budget reached before patching → ITERATION_BUDGET", async () => {
    const t = await setup({ budgets: { maxCandidates: 1 } });
    await t.runtime.idle(t.id);
    const prior: CandidateDesign = {
      schemaVersion: SCHEMA_VERSION,
      id: "cand_prior0001",
      versionId: "ver_prior0001",
      parentVersionId: BASE,
      patchIds: [],
      url: "http://localhost:5173/v/ver_prior0001",
      reviewStatus: "discarded",
      createdAt: NOW,
    };
    await t.store.putCandidate(t.id, prior);
    await t.approveAll();
    const e = await t.exp();
    expect(e.stopping!.reason).toBe("ITERATION_BUDGET");
    expect(states(e).slice(-2)).toEqual(["patching", "stopped"]);
    expect(t.candidates.created).toHaveLength(0);
  });

  it("empty approval → NO_VALID_PATCH", async () => {
    const t = await setup();
    await t.runtime.idle(t.id);
    const r = await t.cmd.approvePatches(t.okApproval());
    expect(r.ok).toBe(true);
    await t.runtime.idle(t.id);
    const e = await t.exp();
    expect(e.stopping!.reason).toBe("NO_VALID_PATCH");
    expect(t.candidates.created).toHaveLength(0);
  });

  it("invalid packet twice → NO_VALID_PATCH", async () => {
    const t = await setup({ analysis: [{ bad: 1 }, { bad: 2 }] });
    await t.runtime.idle(t.id);
    const e = await t.exp();
    expect(e.state).toBe("stopped");
    expect(e.stopping!.reason).toBe("NO_VALID_PATCH");
    expect(t.analysis.calls).toHaveLength(2);
    expect(e.round.analysisAttempts).toBe(2);
    expect(await t.store.listPatches(t.id, 1)).toHaveLength(0);
  });

  it("invalid packet once, then valid → parks at approval", async () => {
    const t = await setup({ analysis: [{ bad: 1 }] });
    await t.runtime.idle(t.id);
    const e = await t.exp();
    expect(e.state).toBe("awaiting_approval");
    expect(t.analysis.calls).toHaveLength(2);
  });

  it("packet with only blocked patches → NO_VALID_PATCH", async () => {
    const t = await setup({
      analysis: [
        (input: { observations: { id: string }[] }) => ({
          hypotheses: [],
          patches: [{ targetElementId: "plan.pro.price", op: "set_label", value: "Free", observationIds: [input.observations[0]!.id], rationale: "r" }],
        }),
      ],
    });
    await t.runtime.idle(t.id);
    const e = await t.exp();
    expect(e.stopping!.reason).toBe("NO_VALID_PATCH");
    expect(e.stopping!.rejectedPatchIds).toHaveLength(1);
  });

  it("resume after restart re-runs baseline and ignores partial batch", async () => {
    // A first process got as far as 3 runs of the baseline before dying.
    const t = await setup({ start: false });
    const partial = loadFixture("batch.baseline.json", BatchResult);
    const oldBatchId = "batch_partial0001";
    const before = await t.exp();
    await t.store.putExperiment({
      ...before,
      state: "baseline_running",
      startedAt: NOW,
      round: { ...before.round, baselineBatchId: oldBatchId },
      transitions: [{ from: "created", to: "baseline_running", at: NOW }],
    });
    await t.store.putBatch({
      batchId: oldBatchId,
      experimentId: t.id,
      versionId: BASE,
      phase: "baseline",
      round: 1,
      plannedRuns: 12,
      cancelled: false,
      usage: { inferenceCalls: 0, inferenceUsd: 0, wallClockMs: 0 },
      superseded: false,
    });
    for (const run of partial.runs.slice(0, 3)) await t.store.putRun({ ...run, experimentId: t.id, batchId: oldBatchId });

    // A new process (fresh runtime + adapters, same store) resumes.
    const fresh = new ExperimentRuntime({
      ...t.deps,
      simulation: createMockSimulation({ baseline: "batch.baseline.json", candidate: "batch.candidate-improved.json" }),
    });
    fresh.launch(t.id);
    await fresh.idle(t.id);
    const e = await t.exp();
    expect(e.state).toBe("awaiting_approval");
    expect(e.round.baselineBatchId).toBeDefined();
    expect(e.round.baselineBatchId).not.toBe(oldBatchId);
    expect((await t.store.getBatch(oldBatchId))!.superseded).toBe(true);
    expect((await t.store.getBatch(e.round.baselineBatchId!))!.superseded).toBe(false);
    expect(await t.store.listRuns(oldBatchId)).toHaveLength(3); // kept, but excluded
    const obs = await t.store.listObservations(t.id);
    expect(obs.length).toBeGreaterThan(0);
    for (const o of obs) {
      expect(o.batchId).toBe(e.round.baselineBatchId);
      expect(o.denominator).toBe(12);
    }
  });

  it("duplicate emitted events stored once", async () => {
    const t = await setup();
    await t.runtime.idle(t.id);
    const e = await t.exp();
    const runs = await t.store.listRuns(e.round.baselineBatchId!);
    expect(runs).toHaveLength(12);
    const fixture = loadFixture("batch.baseline.json", BatchResult);
    const total = fixture.runs.reduce((n, r) => n + r.events.length, 0);
    let stored = 0;
    for (const r of runs) {
      const actions = await t.store.listActions(r.runId);
      const seqs = actions.map((a) => a.seq);
      expect(new Set(seqs).size).toBe(seqs.length);
      expect(actions.every((a) => a.runId === r.runId && a.versionId === BASE)).toBe(true);
      stored += actions.length;
    }
    expect(stored).toBe(total);
    expect(t.simulation.duplicatesEmitted).toBeGreaterThan(0);
  });

  it("cancel before the first step → USER_STOP without any adapter call", async () => {
    const t = await setup({ delayMs: 50 });
    await t.cmd.cancelExperiment({ experimentId: t.id });
    await t.runtime.idle(t.id);
    const e = await t.exp();
    expect(e.stopping!.reason).toBe("USER_STOP");
    expect(t.simulation.calls).toHaveLength(0);
  });

  it("repeated launch while a drive is running does not start a second drive", async () => {
    const t = await setup({ delayMs: 5 });
    t.runtime.launch(t.id);
    t.runtime.launch(t.id);
    await t.runtime.idle(t.id);
    expect((await t.exp()).state).toBe("awaiting_approval");
    expect(t.simulation.calls).toHaveLength(1);
    expect(t.analysis.calls).toHaveLength(1);
  });

  it("every state change is persisted (onChange sees each state)", async () => {
    const t = await setup({ start: false });
    const seen: string[] = [];
    t.store.onChange(async (table, key) => {
      if (table !== "experiments" || key !== t.id) return;
      const s = (await t.store.getExperiment(t.id))!.state;
      if (seen[seen.length - 1] !== s) seen.push(s);
    });
    await t.cmd.startExperiment({ experimentId: t.id });
    await t.runtime.idle(t.id);
    for (const s of ["baseline_running", "observing", "diagnosing", "proposing", "awaiting_approval"]) expect(seen).toContain(s);
  });
});
