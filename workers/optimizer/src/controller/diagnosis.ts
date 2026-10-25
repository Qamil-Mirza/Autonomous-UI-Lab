import { DesignManifest, UsageReport, type Experiment } from "@ghostloop/contracts";
import { aggregateObservations, isSuppressed } from "../observations";
import { protectedConstraintsFor, validatePacket } from "../policy";
import { adapter, addUsage, IntegrationError, metricsFor, parsed, stop, transition, update, type StepContext } from "./context";

const MAX_ANALYSIS_ATTEMPTS = 2;

/** `observing`: summarizes the recorded baseline batch on the transition (no adapter work). */
export async function observing(ctx: StepContext, e: Experiment): Promise<boolean> {
  const m = await metricsFor(ctx, e, e.round.baselineBatchId);
  const rate = m.completionRate === null ? "n/a" : `${m.successes}/${m.validRuns}`;
  await transition(ctx, "diagnosing", undefined, `baseline ${rate} valid runs reached the goal${m.complete ? "" : " (incomplete)"}`);
  return true;
}

/** `diagnosing`: deterministic observations from the current baseline batch (idempotent on resume). */
export async function diagnosing(ctx: StepContext, e: Experiment): Promise<boolean> {
  const { store } = ctx.deps;
  const batchId = e.round.baselineBatchId!;
  let obs = (await store.listObservations(e.id)).filter((o) => o.batchId === batchId);
  if (obs.length === 0) {
    obs = aggregateObservations({
      experimentId: e.id,
      versionId: e.incumbentVersionId,
      batchId,
      runs: await store.listRuns(batchId),
      dispositions: await store.getDispositions(),
    });
    await store.putObservations(obs);
  }
  await transition(ctx, "proposing", undefined, `${obs.length} observations`);
  return true;
}

/**
 * `proposing`: one analysis call with non-suppressed observations and editable (non-protected) elements, validated
 * by code. An invalid packet is retried once (`analysisAttempts`), then NO_VALID_PATCH; zero unblocked patches is
 * also NO_VALID_PATCH. The budget pre-check runs before the retry because the retry is a separate step.
 */
export async function proposing(ctx: StepContext, e: Experiment): Promise<boolean> {
  const { store, clock } = ctx.deps;
  const { protocol } = e;
  const observations = (await store.listObservations(e.id)).filter((o) => o.batchId === e.round.baselineBatchId);
  const manifest = parsed(DesignManifest, await adapter(ctx, "getManifest", () => ctx.deps.candidates.getManifest(e.incumbentVersionId)), "getManifest");
  if (manifest.versionId !== e.incumbentVersionId) {
    // C's fault, not the model's: fail the integration instead of burning an analysis attempt on a packet error.
    throw new IntegrationError(`getManifest answered for ${manifest.versionId}, not the incumbent ${e.incumbentVersionId}`);
  }
  const editableElements = manifest.elements.filter(
    (el) => !el.protected && !protocol.protectedElements.includes(el.elementId) && !el.categories.some((c) => protocol.protectedCategories.includes(c)),
  );
  const out = await adapter(ctx, "proposeFeedback", () =>
    ctx.deps.analysis.proposeFeedback({
      experimentId: e.id,
      versionId: e.incumbentVersionId,
      task: protocol.task,
      intentConstraints: [...protocol.intentConstraints],
      protectedConstraints: protectedConstraintsFor(protocol),
      observations: observations.filter((o) => !isSuppressed(o)),
      editableElements,
    }),
  );
  const usage = parsed(UsageReport, out.usage, "proposeFeedback usage");
  const latest = await update(ctx, (x) => ({
    ...x,
    usage: addUsage(x.usage, usage),
    round: { ...x.round, analysisAttempts: x.round.analysisAttempts + 1 },
  }));

  const result = validatePacket(out.raw, {
    experimentId: e.id,
    round: e.round.index,
    incumbentVersionId: e.incumbentVersionId,
    protocol,
    manifest,
    observations,
    clock,
  });
  if (!result.ok) {
    if (latest.round.analysisAttempts < MAX_ANALYSIS_ATTEMPTS) return true; // retry on the next step
    await stop(ctx, "NO_VALID_PATCH", `invalid packet: ${result.errors.join("; ")}`);
    return true;
  }
  await store.putHypotheses(result.hypotheses);
  await store.putPatches(result.patches);
  await store.putPacket(result.packet);
  const open = result.patches.filter((p) => p.state !== "blocked");
  if (open.length === 0) {
    await stop(ctx, "NO_VALID_PATCH", result.patches.length === 0 ? "the analysis proposed no changes" : "every proposed patch is blocked");
    return true;
  }
  await transition(
    ctx,
    "awaiting_approval",
    (x) => ({ ...x, round: { ...x.round, packetId: result.packet.id } }),
    `${open.length} patches await approval`,
  );
  return true;
}
