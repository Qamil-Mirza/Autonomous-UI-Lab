import {
  SCHEMA_VERSION,
  isBehaviorallyValid,
  newId,
  type AgentRunResult,
  type BatchId,
  type ExperimentId,
  type ObservationDisposition,
  type ObservationKind,
  type ObservationTrend,
  type TraceRef,
  type VersionId,
} from "@ghostloop/contracts";
import { dedupeEvents, dedupeRuns, screenRevisits } from "./evaluator";

export interface AggregateObservationsInput {
  experimentId: ExperimentId;
  versionId: VersionId;
  batchId: BatchId;
  runs: AgentRunResult[];
  /** Prior designer dispositions keyed by fingerprint (per app, not per experiment). */
  dispositions: Map<string, ObservationDisposition>;
}

const FAILED_RESULTS = new Set(["validation_error", "no_effect", "rejected_invalid"]);

export function fingerprintOf(kind: ObservationKind, screens: string[], elementIds: string[]): string {
  return [kind, ...[...screens].sort(), ...[...elementIds].sort()].join("|");
}

export function isSuppressed(o: ObservationTrend): boolean {
  return o.disposition === "intentional" || o.disposition === "not_relevant";
}

interface Bucket {
  screens: Set<string>;
  refs: TraceRef[];
}

function addTo(map: Map<string, Bucket>, key: string, screen: string | null, ref: TraceRef): void {
  let b = map.get(key);
  if (!b) {
    b = { screens: new Set(), refs: [] };
    map.set(key, b);
  }
  if (screen !== null) b.screens.add(screen);
  b.refs.push(ref);
}

const sortedKeys = <V>(m: Map<string, V>): string[] => [...m.keys()].sort();

/**
 * Deterministic, neutral findings from one batch (spec 5.3). Counts only; no causal language.
 * One `outcome_count` summary over all runs, then behavioral kinds over behaviorally valid runs,
 * each emitted only when at least one run matches.
 */
export function aggregateObservations(input: AggregateObservationsInput): ObservationTrend[] {
  const { experimentId, versionId, batchId, dispositions } = input;
  const runs = dedupeRuns(input.runs);
  const valid = runs.filter((r) => isBehaviorallyValid(r.outcome));
  const d = valid.length;

  const out: ObservationTrend[] = [];
  const emit = (
    kind: ObservationKind,
    statement: string,
    numerator: number,
    denominator: number,
    traceRefs: TraceRef[],
    screens: string[],
    elementIds: string[],
  ): void => {
    const fingerprint = fingerprintOf(kind, screens, elementIds);
    out.push({
      schemaVersion: SCHEMA_VERSION,
      id: newId("obs"),
      experimentId,
      versionId,
      batchId,
      kind,
      statement,
      numerator,
      denominator,
      traceRefs,
      screens: [...screens].sort(),
      elementIds: [...elementIds].sort(),
      disposition: dispositions.get(fingerprint) ?? "unreviewed",
      fingerprint,
    });
  };

  // outcome_count: successes over valid runs; infra and cancelled stated separately.
  const goals = valid.filter((r) => r.outcome === "goal");
  const infra = runs.filter((r) => r.outcome === "model_error" || r.outcome === "browser_error").length;
  const cancelled = runs.filter((r) => r.outcome === "user_cancelled").length;
  emit(
    "outcome_count",
    `${goals.length} of ${d} valid runs reached the goal; ${infra} infrastructure errors; ${cancelled} cancelled`,
    goals.length,
    d,
    goals.map((r) => ({ runId: r.runId })),
    [],
    [],
  );

  const revisits = new Map<string, Bucket>();
  const repeated = new Map<string, Bucket>();
  const validation = new Map<string, Bucket>();
  const stepLimit: TraceRef[] = [];

  for (const r of valid) {
    // Scripted scenario steps (decisionSource "scenario", e.g. an injected typo) are test setup, not user behavior.
    const events = dedupeEvents(r.events).filter((e) => e.decisionSource !== "scenario");

    for (const [screen, seq] of screenRevisits(events)) addTo(revisits, screen, null, { runId: r.runId, seq });

    // Per element in this run: failed-result events, and first validation error.
    const failed = new Map<string, { count: number; screens: Set<string>; secondSeq?: number }>();
    const firstValidation = new Map<string, { seq: number; screen: string }>();
    for (const e of events) {
      const el = e.action.elementId;
      if (el === undefined || !FAILED_RESULTS.has(e.result)) continue;
      const f = failed.get(el) ?? { count: 0, screens: new Set<string>() };
      f.count += 1;
      f.screens.add(e.screenBefore);
      if (f.count === 2) f.secondSeq = e.seq;
      failed.set(el, f);
      if (e.result === "validation_error" && !firstValidation.has(el)) firstValidation.set(el, { seq: e.seq, screen: e.screenBefore });
    }
    for (const [el, f] of failed) {
      if (f.count < 2) continue;
      addTo(repeated, el, null, { runId: r.runId, seq: f.secondSeq! });
      for (const s of f.screens) repeated.get(el)!.screens.add(s);
    }
    for (const [el, v] of firstValidation) addTo(validation, el, v.screen, { runId: r.runId, seq: v.seq });

    if (r.outcome === "step_limit") stepLimit.push({ runId: r.runId });
  }

  for (const screen of sortedKeys(revisits)) {
    const b = revisits.get(screen)!;
    emit("screen_revisit", `${b.refs.length} of ${d} runs revisited ${screen}`, b.refs.length, d, b.refs, [screen], []);
  }
  for (const el of sortedKeys(repeated)) {
    const b = repeated.get(el)!;
    emit("repeated_failed_action", `${b.refs.length} of ${d} runs repeated a failed action on ${el}`, b.refs.length, d, b.refs, [...b.screens], [el]);
  }
  for (const el of sortedKeys(validation)) {
    const b = validation.get(el)!;
    emit("validation_error", `${b.refs.length} of ${d} runs hit a validation error on ${el}`, b.refs.length, d, b.refs, [...b.screens], [el]);
  }
  if (stepLimit.length > 0) {
    emit("step_limit", `${stepLimit.length} of ${d} runs reached the step limit`, stepLimit.length, d, stepLimit, [], []);
  }

  return out;
}
