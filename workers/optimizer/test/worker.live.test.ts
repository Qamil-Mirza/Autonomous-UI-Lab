import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setGlobalLogLevel } from "spacetimedb";
import { BatchRecord, DesignManifest, Evaluation, Experiment, ExperimentProtocol, MutationPatch, type SimulationAdapter } from "@ghostloop/contracts";
import { loadFixture } from "@ghostloop/contracts/fixtures";
import { connect, parseRow, submitCommand, type DbConnection } from "@ghostloop/db";
import { publishTestDb } from "@ghostloop/db/test-support";
import { SpacetimeStore } from "../src/spacetime-store";
import { startWorker } from "../src/worker";

setGlobalLogLevel("warn"); // keep the SDK's per-connection info lines out of test output

/** Polls `check` until it returns true; another connection's cache lags the worker's writes. */
async function waitFor(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const { id: _id, frozenAt: _f, experimentId: _e, ...protocol } = loadFixture("protocol.default.json", ExperimentProtocol);
const manifest = loadFixture("manifest.base.json", DesignManifest);
const createPayload = { protocol, baseVersionUrl: "http://localhost:5173/v/ver_base0001", baseManifestHash: manifest.manifestHash };

/** A simulation whose batch never finishes: the worker is closed while the baseline is in flight. */
const hangingSimulation: SimulationAdapter = { runBatch: () => new Promise(() => {}) };

type Worker = Awaited<ReturnType<typeof startWorker>>;

describe.skipIf(!process.env.GHOSTLOOP_STDB_TEST)("worker (live)", () => {
  let target: { uri: string; database: string };
  let tokenPath: string;
  let dash: DbConnection;
  const workers: Worker[] = [];

  const start = async (opts: Partial<Parameters<typeof startWorker>[0]> = {}) => {
    const w = await startWorker({ ...target, tokenPath, log: () => {}, ...opts });
    workers.push(w);
    return w;
  };
  // The dashboard's view: an anonymous connection reading rows from its own cache.
  const experiment = (id: string) => {
    const row = dash.db.experiment.id.find(id);
    return row && parseRow(Experiment, "experiment", row.id, row.json);
  };
  const patches = (id: string) =>
    [...dash.db.patch.iter()].filter((r) => r.experimentId === id).map((r) => parseRow(MutationPatch, "patch", r.id, r.json));
  const evaluation = (id: string) => {
    const row = dash.db.evaluation.id.find(id);
    return row && parseRow(Evaluation, "evaluation", row.id, row.json);
  };
  const batches = (id: string) =>
    [...dash.db.batch.iter()].filter((r) => r.experimentId === id).map((r) => parseRow(BatchRecord, "batch", r.id, r.json));

  /** Creates and starts an experiment through commands; resolves once the dashboard sees `state`. */
  async function createAndStart(state = "awaiting_approval"): Promise<string> {
    const created = await submitCommand(dash, "createExperiment", createPayload);
    if (!created.ok) throw new Error(`create failed: ${created.message}`);
    const id = (created.value as { experimentId: string }).experimentId;
    expect(await submitCommand(dash, "startExperiment", { experimentId: id })).toMatchObject({ ok: true });
    await waitFor(() => experiment(id)?.state === state);
    return id;
  }

  const approveFirst = (id: string) => {
    const pick = patches(id).find((p) => p.state !== "blocked")!;
    return submitCommand(dash, "approvePatches", {
      experimentId: id,
      sourceVersionId: "ver_base0001",
      round: 1,
      patchIds: [pick.id],
      approvedBy: "designer",
    });
  };

  const expectAccepted = async (id: string) => {
    await waitFor(() => experiment(id)?.state === "accepted" && experiment(id)?.round.evaluationId !== undefined);
    const ev = evaluation(experiment(id)!.round.evaluationId!);
    expect(ev?.decision).toBe("accepted");
    return ev!;
  };

  beforeAll(async () => {
    target = await publishTestDb("ghostloop-test-worker");
    tokenPath = join(mkdtempSync(join(tmpdir(), "ghostloop-worker-")), "nested", "worker-token");
    dash = (await connect(target)).conn;
  }, 180_000);

  beforeEach(async () => {
    // Clear state left by the previous test, as the writer whose token the worker persisted.
    if (!existsSync(tokenPath)) return;
    const store = await SpacetimeStore.open({ ...target, token: readFileSync(tokenPath, "utf8") });
    await store.devReset();
    await store.close();
    await waitFor(() => [...dash.db.experiment.iter()].length === 0 && [...dash.db.command.iter()].length === 0);
  });

  afterEach(async () => {
    await Promise.all(workers.splice(0).map((w) => w.close()));
  });

  it("runs a full round through dashboard commands", async () => {
    const w = await start();
    expect(readFileSync(tokenPath, "utf8")).toBe(w.store.token);
    const id = await createAndStart();
    expect(await approveFirst(id)).toMatchObject({ ok: true });
    await expectAccepted(id);
  });

  it("completes an invalid payload as VALIDATION_FAILED", async () => {
    await start();
    const result = await submitCommand(dash, "startExperiment", { experimentId: 42 });
    expect(result).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
  });

  it("fails a command left running by a closed worker", async () => {
    const first = await start();
    await first.close();
    workers.splice(0);
    // Act as a worker that died mid-command: submit, then start the row with the writer's identity.
    const writer = (await connect({ ...target, token: first.store.token })).conn;
    try {
      await writer.reducers.submitCommand({ kind: "startExperiment", payloadJson: JSON.stringify({ experimentId: "exp_x" }) });
      const row = [...writer.db.command.iter()].find((r) => r.status === "pending")!;
      await writer.reducers.startCommand({ id: row.id });
      await waitFor(() => dash.db.command.id.find(row.id)?.status === "running");

      await start();
      await waitFor(() => dash.db.command.id.find(row.id)?.status === "error");
      expect(JSON.parse(dash.db.command.id.find(row.id)!.resultJson!)).toEqual({
        ok: false,
        code: "INTERNAL",
        message: "worker restarted; resubmit",
      });
    } finally {
      writer.disconnect();
    }
  });

  it("resumes an experiment closed at baseline_running without double counting", async () => {
    const first = await start({ adapters: { simulation: hangingSimulation } });
    const id = await createAndStart("baseline_running");
    await waitFor(() => experiment(id)?.round.baselineBatchId !== undefined);
    await first.close(); // the hanging drive is left behind; close must not record USER_STOP

    await start();
    await waitFor(() => experiment(id)?.state === "awaiting_approval");
    expect(experiment(id)?.stopping).toBeUndefined();
    expect(await approveFirst(id)).toMatchObject({ ok: true });
    const ev = await expectAccepted(id);
    expect(ev.baseline).toMatchObject({ successes: 6, validRuns: 12 });
    const baselines = batches(id).filter((b) => b.phase === "baseline");
    expect(baselines.map((b) => b.superseded).sort()).toEqual([false, true]);
  });

  it("repairs a half-written approval on restart", async () => {
    const first = await start();
    const id = await createAndStart();
    const pick = patches(id).find((p) => p.state !== "blocked")!;
    // An approvePatches that died after claiming the round and writing a patch state, before the Approval record.
    await first.store.updateExperiment(id, (x) => ({ ...x, round: { ...x.round, approvalId: "appr_lost0001" } }));
    await first.store.updatePatch(pick.id, { state: "approved" });
    await first.close();

    await start();
    await waitFor(() => experiment(id)?.round.approvalId === undefined);
    expect(patches(id).find((p) => p.id === pick.id)?.state).toBe("proposed");
    expect(await approveFirst(id)).toMatchObject({ ok: true });
    await expectAccepted(id);
  });

  it("rejects a worker with another identity once the writer is claimed", async () => {
    await start();
    const otherToken = join(mkdtempSync(join(tmpdir(), "ghostloop-other-")), "worker-token");
    const err = await startWorker({ ...target, tokenPath: otherToken, log: () => {} }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect((err as Error).message).toMatch(/^NOT_WRITER:/);
    expect((err as Error).message).toContain("npm run stdb:publish:fresh");
  });
});
