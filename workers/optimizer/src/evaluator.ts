import {
  RunOutcome,
  isBehaviorallyValid,
  type AgentActionEvent,
  type AgentRunResult,
  type EvaluationDecision,
  type EvaluationPolicy,
  type GuardrailResult,
  type OutcomeCounts,
  type RunMetrics,
  type Scenario,
  type ScenarioMetrics,
  type StoppingReason,
} from "@ghostloop/contracts";

export interface ComputeMetricsInput {
  versionId: RunMetrics["versionId"];
  batchId: RunMetrics["batchId"];
  runs: AgentRunResult[];
  plannedRuns: number;
  scenarios: Scenario[];
  policy: EvaluationPolicy;
}

/** Unique by (runId, seq), first occurrence wins, sorted by seq. */
export function dedupeEvents(events: AgentActionEvent[]): AgentActionEvent[] {
  const seen = new Set<string>();
  const out: AgentActionEvent[] = [];
  for (const e of events) {
    const key = `${e.runId}\u0000${e.seq}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out.sort((a, b) => a.seq - b.seq);
}

/** True if, in seq order, some event starts on a screen the run previously left (screenAfter differed). */
export function isBacktrackRun(events: AgentActionEvent[]): boolean {
  const left = new Set<string>();
  for (const e of dedupeEvents(events)) {
    if (left.has(e.screenBefore)) return true;
    if (e.screenAfter !== e.screenBefore) left.add(e.screenBefore);
  }
  return false;
}

function dedupeRuns(runs: AgentRunResult[]): AgentRunResult[] {
  const seen = new Set<string>();
  const out: AgentRunResult[] = [];
  for (const r of runs) {
    if (seen.has(r.runId)) continue;
    seen.add(r.runId);
    out.push(r);
  }
  return out;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function emptyCounts(): OutcomeCounts {
  return Object.fromEntries(RunOutcome.options.map((o) => [o, 0])) as OutcomeCounts;
}

interface Tally {
  counts: OutcomeCounts;
  validRuns: number;
  successes: number;
  goalSteps: number[];
}

function tally(runs: AgentRunResult[]): Tally {
  const t: Tally = { counts: emptyCounts(), validRuns: 0, successes: 0, goalSteps: [] };
  for (const r of runs) {
    t.counts[r.outcome] += 1;
    if (isBehaviorallyValid(r.outcome)) t.validRuns += 1;
    if (r.outcome === "goal") {
      t.successes += 1;
      t.goalSteps.push(dedupeEvents(r.events).filter((e) => e.action.type !== "stop").length);
    }
  }
  return t;
}

export function computeMetrics(input: ComputeMetricsInput): RunMetrics {
  const { scenarios, policy, plannedRuns } = input;
  const runs = dedupeRuns(input.runs);
  const t = tally(runs);

  const perScenario: ScenarioMetrics[] = scenarios.map((s) => {
    const st = tally(runs.filter((r) => r.scenarioId === s.id));
    return {
      scenarioId: s.id,
      plannedRuns: s.runs,
      validRuns: st.validRuns,
      successes: st.successes,
      completionRate: st.validRuns === 0 ? null : st.successes / st.validRuns,
      outcomeCounts: st.counts,
      medianActionsToSuccess: median(st.goalSteps),
      complete: st.validRuns >= policy.minValidPerScenario,
    };
  });

  const required = Math.ceil(policy.minValidFraction * plannedRuns);
  const reasons: string[] = [];
  if (t.validRuns < required) {
    reasons.push(`only ${t.validRuns} valid runs of ${plannedRuns} planned; need at least ${required}`);
  }
  const short = perScenario.filter((s) => !s.complete).map((s) => s.scenarioId);
  if (short.length > 0) {
    reasons.push(`scenarios below ${policy.minValidPerScenario} valid run(s): ${short.join(", ")}`);
  }

  const metrics: RunMetrics = {
    versionId: input.versionId,
    batchId: input.batchId,
    plannedRuns,
    validRuns: t.validRuns,
    successes: t.successes,
    completionRate: t.validRuns === 0 ? null : t.successes / t.validRuns,
    outcomeCounts: t.counts,
    infraErrors: t.counts.model_error + t.counts.browser_error,
    cancelled: t.counts.user_cancelled,
    medianActionsToSuccess: median(t.goalSteps),
    backtrackRuns: runs.filter((r) => isBehaviorallyValid(r.outcome) && isBacktrackRun(r.events)).length,
    validationErrorRuns: runs.filter(
      (r) => isBehaviorallyValid(r.outcome) && dedupeEvents(r.events).some((e) => e.result === "validation_error"),
    ).length,
    perScenario,
    complete: reasons.length === 0,
  };
  if (reasons.length > 0) metrics.incompleteReason = reasons.join("; ");
  return metrics;
}

export interface Comparison {
  decision: EvaluationDecision;
  deltaPp: number | null;
  reasons: string[];
}

const round1 = (x: number): number => Math.round(x * 10) / 10;
const fmtPp = (x: number): string => `${x >= 0 ? "+" : ""}${x.toFixed(1)}pp`;

/** Spec 5.2 compare, steps 1-7 in order. */
export function compare(
  baseline: RunMetrics,
  candidate: RunMetrics | null,
  guardrails: GuardrailResult[],
  policy: EvaluationPolicy,
): Comparison {
  // 1. Failed guardrail wins over everything.
  const failed = guardrails.filter((g) => !g.passed);
  if (failed.length > 0) {
    return {
      decision: "rejected",
      deltaPp: null,
      reasons: failed.map((g) => `guardrail failed: ${g.name}${g.detail ? ` (${g.detail})` : ""}`),
    };
  }
  if (candidate === null) {
    return { decision: "inconclusive", deltaPp: null, reasons: ["no candidate metrics to compare"] };
  }

  // 2. Incomplete side or null rate.
  const baseRate = baseline.completionRate;
  const candRate = candidate.completionRate;
  const reasons: string[] = [];
  if (!baseline.complete) reasons.push(`baseline incomplete${baseline.incompleteReason ? `: ${baseline.incompleteReason}` : ""}`);
  if (baseRate === null) reasons.push("baseline has no valid runs");
  if (!candidate.complete) reasons.push(`candidate incomplete${candidate.incompleteReason ? `: ${candidate.incompleteReason}` : ""}`);
  if (candRate === null) reasons.push("candidate has no valid runs");
  if (reasons.length > 0 || baseRate === null || candRate === null) {
    return { decision: "inconclusive", deltaPp: null, reasons };
  }

  // 3. Delta.
  const deltaPp = round1((candRate - baseRate) * 100);

  // 4. Secondary regressions.
  const regressions: string[] = [];
  if (baseline.medianActionsToSuccess !== null && candidate.medianActionsToSuccess !== null) {
    const inc = candidate.medianActionsToSuccess - baseline.medianActionsToSuccess;
    if (inc > policy.maxMedianActionsIncrease) {
      regressions.push(`median actions to success up ${inc} (limit ${policy.maxMedianActionsIncrease})`);
    }
  }
  const baseVe = (baseline.validationErrorRuns / baseline.validRuns) * 100;
  const candVe = (candidate.validationErrorRuns / candidate.validRuns) * 100;
  const veInc = candVe - baseVe;
  if (veInc > policy.maxValidationErrorRateIncreasePp) {
    regressions.push(`validation-error run rate up ${veInc.toFixed(1)}pp (limit ${policy.maxValidationErrorRateIncreasePp}pp)`);
  }
  if (regressions.length > 0) {
    return { decision: "rejected", deltaPp, reasons: [`secondary regression: ${regressions.join("; ")}`] };
  }

  // 5-7. Rate thresholds.
  if (deltaPp >= policy.minImprovementPp) {
    return { decision: "accepted", deltaPp, reasons: [`completion rate ${fmtPp(deltaPp)} \u2265 ${policy.minImprovementPp}pp margin`] };
  }
  if (deltaPp <= -policy.minImprovementPp) {
    return { decision: "rejected", deltaPp, reasons: [`completion rate ${fmtPp(deltaPp)} \u2264 -${policy.minImprovementPp}pp margin`] };
  }
  return {
    decision: "inconclusive",
    deltaPp,
    reasons: [`completion rate ${fmtPp(deltaPp)} within \u00b1${policy.minImprovementPp}pp margin`],
  };
}

/** `null` means park in `accepted` (round complete, no stopping record yet). */
export function stoppingReasonFor(
  decision: EvaluationDecision,
  candidateRate: number | null,
  policy: EvaluationPolicy,
  round: number,
  maxIterations: number,
): StoppingReason | null {
  switch (decision) {
    case "accepted":
      if (candidateRate !== null && candidateRate >= policy.targetCompletionRate) return "TARGET_MET";
      if (round >= maxIterations) return "ITERATION_BUDGET";
      return null;
    case "rejected":
      return "NO_MEASURED_IMPROVEMENT";
    case "inconclusive":
      return "INCONCLUSIVE";
  }
}
