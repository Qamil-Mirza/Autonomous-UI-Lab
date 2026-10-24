import type {
  AnalysisAdapter,
  CandidateAdapter,
  Experiment,
  ExperimentState,
  RunMetrics,
  SimulationAdapter,
  StoppingReason,
  StoppingRecord,
  UsageReport,
} from "@ghostloop/contracts";
import type { z } from "zod";
import { computeMetrics } from "../evaluator";
import { isSuppressed } from "../observations";
import type { ExperimentStore } from "../store";

export type ControllerDeps = {
  store: ExperimentStore;
  simulation: SimulationAdapter;
  analysis: AnalysisAdapter;
  candidates: CandidateAdapter;
  /** ISO timestamp for records and transitions. */
  clock: () => string;
  /** Epoch ms for the wall-clock budget (injected so tests control time). */
  now: () => number;
};

/** Per-step context handed to every state handler. */
export interface StepContext {
  id: string;
  deps: ControllerDeps;
  signal: AbortSignal;
}

/**
 * A B/C/model adapter threw or returned something unusable. The controller turns it into `INTEGRATION_FAILURE`
 * (or `USER_STOP` when a cancel is pending) and never interprets the message text.
 */
export class IntegrationError extends Error {}

export async function adapter<T>(what: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    throw new IntegrationError(`${what} failed${err instanceof Error ? `: ${err.message}` : ""}`);
  }
}

/** Parses adapter output; malformed output is an integration failure like a throw. */
export function parsed<S extends z.ZodTypeAny>(schema: S, value: unknown, what: string): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw new IntegrationError(`${what} returned invalid data: ${r.error.issues.map((i) => i.message).join("; ")}`);
  return r.data;
}

export async function load(ctx: StepContext): Promise<Experiment> {
  const e = await ctx.deps.store.getExperiment(ctx.id);
  if (!e) throw new Error(`experiment ${ctx.id} not found`);
  return e;
}

/**
 * Atomically applies `change` to the latest stored experiment. Never write a copy read before an await: commands
 * (cancel, approve) may have written meanwhile, and a stale copy would erase their writes.
 */
export async function update(ctx: StepContext, change: (e: Experiment) => Experiment): Promise<Experiment> {
  return ctx.deps.store.updateExperiment(ctx.id, change);
}

/** A cancel is pending if the command set the flag or aborted this experiment's signal. */
export const cancelPending = (ctx: StepContext, e: Experiment): boolean => e.cancelRequested || ctx.signal.aborted;

/** Appends `{from, to, at}` and moves to `to`. A pending cancel wins: the experiment stops with USER_STOP instead. */
export async function transition(
  ctx: StepContext,
  to: ExperimentState,
  change: (e: Experiment) => Experiment = (e) => e,
  note?: string,
): Promise<void> {
  if (cancelPending(ctx, await load(ctx))) return stop(ctx, "USER_STOP");
  await update(ctx, (latest) => ({
    ...change(latest),
    state: to,
    transitions: [...latest.transitions, { from: latest.state, to, at: ctx.deps.clock(), ...(note !== undefined && { note }) }],
  }));
}

/** Moves to `stopped` with the full stopping record (spec 5.6). No-op if already stopped. */
export async function stop(ctx: StepContext, reason: StoppingReason, note?: string): Promise<void> {
  const snapshot = await load(ctx);
  if (snapshot.state === "stopped") return;
  const stopping = await stoppingRecord(ctx, snapshot, reason);
  await update(ctx, (latest) =>
    latest.state === "stopped"
      ? latest
      : {
          ...latest,
          state: "stopped",
          stopping,
          transitions: [
            ...latest.transitions,
            { from: latest.state, to: "stopped", at: stopping.at, note: note ? `${reason}: ${note}` : reason },
          ],
        },
  );
}

async function stoppingRecord(ctx: StepContext, e: Experiment, reason: StoppingReason): Promise<StoppingRecord> {
  const { store } = ctx.deps;
  const candidates = await store.listCandidates(e.id);
  const evaluations = await store.listEvaluations(e.id);
  const patches = (await Promise.all(Array.from({ length: e.round.index }, (_, i) => store.listPatches(e.id, i + 1)))).flat();
  const addressed = new Set(patches.filter((p) => p.state === "applied").flatMap((p) => p.observationIds));
  const observations = (await store.listObservations(e.id)).filter((o) => o.batchId === e.round.baselineBatchId);
  return {
    reason,
    at: ctx.deps.clock(),
    // Spec 5.6: the incumbent only moves via promoted_measured, so it is the best accepted version.
    bestVersionId: e.incumbentVersionId,
    attemptedCandidateIds: candidates.map((c) => c.id),
    evaluationIds: evaluations.map((x) => x.id),
    rejectedPatchIds: patches.filter((p) => p.state === "blocked" || p.state === "declined").map((p) => p.id),
    remainingObservationIds: observations.filter((o) => !isSuppressed(o) && !addressed.has(o.id)).map((o) => o.id),
  };
}

export function addUsage(a: UsageReport, b: UsageReport): UsageReport {
  return {
    inferenceCalls: a.inferenceCalls + b.inferenceCalls,
    inferenceUsd: a.inferenceUsd + b.inferenceUsd,
    wallClockMs: a.wallClockMs + b.wallClockMs,
  };
}

/** Metrics over exactly one batch's stored runs (superseded batches are never passed here). */
export async function metricsFor(ctx: StepContext, e: Experiment, batchId: string | undefined): Promise<RunMetrics> {
  const batch = batchId ? await ctx.deps.store.getBatch(batchId) : undefined;
  if (!batch || batch.superseded) throw new Error(`experiment ${e.id}: no current batch ${batchId ?? "(none)"}`);
  return computeMetrics({
    versionId: batch.versionId,
    batchId: batch.batchId,
    runs: await ctx.deps.store.listRuns(batch.batchId),
    plannedRuns: batch.plannedRuns,
    scenarios: e.protocol.scenarios,
    policy: e.protocol.policy,
  });
}
