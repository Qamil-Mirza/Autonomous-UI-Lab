import { describe, expect, it } from "vitest";
import { DesignManifest, ExperimentProtocol, type ExperimentProtocolDraft } from "@ghostloop/contracts";
import { loadFixture } from "@ghostloop/contracts/fixtures";
import { createCommands } from "../src/commands";
import { ExperimentRuntime, type ControllerDeps } from "../src/controller";
import { createMockAnalysis } from "../src/mocks/analysis";
import { createMockCandidates } from "../src/mocks/candidates";
import { createMockSimulation } from "../src/mocks/simulation";
import { recoverInterruptedApprovals } from "../src/recovery";
import { InMemoryStore } from "../src/store";

const NOW = "2026-10-24T10:00:00.000Z";
const BASE = "ver_base0001";
const fixtureProtocol = loadFixture("protocol.default.json", ExperimentProtocol);
const baseManifest = loadFixture("manifest.legacy.json", DesignManifest);
const { id: _id, frozenAt: _f, experimentId: _e, ...draft } = fixtureProtocol;

/** Drives a fresh experiment on the mock adapters until it parks at `awaiting_approval`. */
async function parkedExperiment(store: InMemoryStore) {
  const deps: ControllerDeps = {
    store,
    simulation: createMockSimulation({ baseline: "batch.baseline.json", candidate: "batch.candidate-improved.json" }),
    analysis: createMockAnalysis([], 0.05),
    candidates: createMockCandidates({}),
    clock: () => NOW,
    now: () => Date.parse(NOW),
  };
  const runtime = new ExperimentRuntime(deps);
  const cmd = createCommands(store, runtime, () => NOW);
  const protocol: ExperimentProtocolDraft = { ...draft };
  const created = await cmd.createExperiment({
    protocol,
    baseVersionUrl: "http://localhost:5173/v/ver_base0001",
    baseManifestHash: baseManifest.manifestHash,
  });
  if (!created.ok) throw new Error(created.message);
  const id = created.value.experimentId;
  const started = await cmd.startExperiment({ experimentId: id });
  if (!started.ok) throw new Error(started.message);
  await runtime.idle(id);
  expect((await store.getExperiment(id))!.state).toBe("awaiting_approval");
  return { id, runtime, cmd };
}

describe("recoverInterruptedApprovals", () => {
  it("repairs a claimed round with no Approval so approval can be resubmitted", async () => {
    const store = new InMemoryStore();
    const { id, runtime, cmd } = await parkedExperiment(store);
    const before = await store.listPatches(id, 1);
    const [a, b] = before.filter((p) => p.state === "proposed");
    const blocked = before.filter((p) => p.state === "blocked");
    expect(blocked.length).toBeGreaterThan(0);
    // The crash window: claim written, two patch states written, Approval never written.
    await store.updateExperiment(id, (x) => ({ ...x, round: { ...x.round, approvalId: "appr_x" as never } }));
    await store.updatePatch(a!.id, { state: "approved" });
    await store.updatePatch(b!.id, { state: "declined" });

    expect(await recoverInterruptedApprovals(store)).toEqual([id]);

    const exp = (await store.getExperiment(id))!;
    expect(exp.round.approvalId).toBeUndefined();
    expect(exp.state).toBe("awaiting_approval");
    const after = await store.listPatches(id, 1);
    expect(after.filter((p) => p.state === "proposed").map((p) => p.id)).toEqual(
      before.filter((p) => p.state === "proposed").map((p) => p.id),
    );
    expect(after.filter((p) => p.state === "blocked")).toEqual(blocked);

    const r = await cmd.approvePatches({
      experimentId: id,
      sourceVersionId: BASE,
      round: 1,
      patchIds: [a!.id, b!.id],
      approvedBy: "d",
    });
    expect(r.ok).toBe(true);
    await runtime.idle(id);
    expect((await store.getExperiment(id))!.state).not.toBe("awaiting_approval");
  });

  it("leaves an awaiting_approval round untouched when its Approval record exists", async () => {
    const store = new InMemoryStore();
    const { id } = await parkedExperiment(store);
    const proposed = (await store.listPatches(id, 1)).filter((p) => p.state === "proposed");
    const approval = {
      schemaVersion: "1.0.0" as const,
      id: "appr_done" as const,
      experimentId: id as never,
      round: 1,
      sourceVersionId: BASE as never,
      patchIds: proposed.map((p) => p.id),
      approvedBy: "d",
      at: NOW,
    };
    // Claim, patch states and Approval all written, but the drive has not moved on yet.
    await store.updateExperiment(id, (x) => ({ ...x, round: { ...x.round, approvalId: approval.id } }));
    for (const p of proposed) await store.updatePatch(p.id, { state: "approved" });
    await store.putApproval(approval);

    const before = [await store.getExperiment(id), await store.listPatches(id, 1)];
    expect(before[0]).toMatchObject({ state: "awaiting_approval", round: { approvalId: "appr_done" } });
    expect(await recoverInterruptedApprovals(store)).toEqual([]);
    expect([await store.getExperiment(id), await store.listPatches(id, 1)]).toEqual(before);
  });

  it("leaves a completed approval and experiments in other states untouched", async () => {
    const store = new InMemoryStore();
    const approved = await parkedExperiment(store);
    const patches = (await store.listPatches(approved.id, 1)).filter((p) => p.state === "proposed");
    const r = await approved.cmd.approvePatches({
      experimentId: approved.id,
      sourceVersionId: BASE,
      round: 1,
      patchIds: patches.map((p) => p.id),
      approvedBy: "d",
    });
    expect(r.ok).toBe(true);
    // Another experiment that is mid-flight (not awaiting approval) but carries a stray claim.
    const other = await parkedExperiment(store);
    await store.updateExperiment(other.id, (x) => ({ ...x, state: "observing", round: { ...x.round, approvalId: "appr_y" as never } }));
    await approved.runtime.idle(approved.id);

    const snapshot = async () => [await store.getExperiment(approved.id), await store.getExperiment(other.id), await store.listPatches(approved.id, 1)];
    const before = await snapshot();
    expect(await recoverInterruptedApprovals(store)).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });
});
