import { AgentActionEvent, BatchResult, DEFAULT_VETO_RULES, newId, type BatchRecord, type BatchRequest, type Experiment } from "@ghostloop/contracts";
import { adapter, addUsage, IntegrationError, parsed, transition, update, type StepContext } from "./context";

const ZERO_USAGE = { inferenceCalls: 0, inferenceUsd: 0, wallClockMs: 0 };

/**
 * `baseline_running` / `candidate_running`: one fresh batch under the frozen protocol. A batch id already recorded
 * for this phase means a previous process died mid-batch: that batch is marked superseded (kept, never evaluated)
 * and a new one starts.
 */
export async function runBatchPhase(ctx: StepContext, e: Experiment, phase: "baseline" | "candidate"): Promise<boolean> {
  const { store } = ctx.deps;
  const key = phase === "baseline" ? "baselineBatchId" : "candidateBatchId";
  let versionId = e.incumbentVersionId;
  if (phase === "candidate") {
    const cand = e.round.candidateId ? await store.getCandidate(e.round.candidateId) : undefined;
    if (!cand) throw new Error(`experiment ${e.id}: candidate_running without a candidate`);
    versionId = cand.versionId;
  }
  const version = await store.getVersion(versionId);
  if (!version) throw new Error(`design version ${versionId} not found`);

  const prior = e.round[key];
  if (prior) {
    const old = await store.getBatch(prior);
    if (old) await store.putBatch({ ...old, superseded: true });
  }
  const { protocol } = e;
  const record: BatchRecord = {
    batchId: newId("batch"),
    experimentId: e.id,
    versionId: version.id,
    phase,
    round: e.round.index,
    plannedRuns: protocol.budgets.runsPerBatch,
    cancelled: false,
    usage: ZERO_USAGE,
    superseded: false,
  };
  await store.putBatch(record);
  await update(ctx, (x) => ({ ...x, round: { ...x.round, [key]: record.batchId } }));

  const req: BatchRequest = {
    batchId: record.batchId,
    experimentId: e.id,
    protocolId: protocol.id,
    versionId: version.id,
    versionUrl: version.url,
    task: protocol.task,
    scenarios: protocol.scenarios,
    runsPerBatch: protocol.budgets.runsPerBatch,
    maxActionsPerRun: protocol.budgets.maxActionsPerRun,
    maxConcurrency: protocol.budgets.maxConcurrency,
    hiddenGoalRef: protocol.hiddenGoalRef,
    vetoRules: protocol.vetoRules ?? [...DEFAULT_VETO_RULES],
  };
  const streamed: Promise<boolean>[] = [];
  // Streamed events are untrusted: store only schema-valid events for the requested version. Run IDs are unknown until
  // the result returns, so a skipped event is restored from the validated `BatchResult` copy that `putRun` inserts.
  const onEvent = (ev: unknown): void => {
    const p = AgentActionEvent.safeParse(ev);
    if (!p.success || p.data.versionId !== req.versionId) return;
    streamed.push(store.insertAction(p.data));
  };
  const raw = await adapter(ctx, "runBatch", () => ctx.deps.simulation.runBatch(req, onEvent, ctx.signal));
  await Promise.all(streamed);
  const result = parsed(BatchResult, raw, "runBatch");
  const foreign = result.runs.filter((r) => r.batchId !== req.batchId || r.versionId !== req.versionId);
  if (result.batchId !== req.batchId || foreign.length > 0) {
    throw new IntegrationError(`runBatch returned runs for a different batch or version than ${req.batchId}/${req.versionId}`);
  }

  // B receives `experimentId` in the request; the controller still stamps the owner on stored runs as a defensive override.
  for (const run of result.runs) await store.putRun({ ...run, experimentId: e.id });
  await store.putBatch({ ...record, cancelled: result.cancelled, usage: result.usage, ...(result.judge ? { judge: result.judge } : {}) });
  await update(ctx, (x) => ({ ...x, usage: addUsage(x.usage, result.usage) }));
  await transition(ctx, phase === "baseline" ? "observing" : "comparing", undefined, `${result.runs.length} of ${req.runsPerBatch} runs recorded${result.cancelled ? " (batch cancelled)" : ""}`);
  return true;
}
