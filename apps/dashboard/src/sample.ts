import { experiment, observations, patches, runs, scenarios } from "./sampleData"
import type { BehaviorRow, ExperimentSummary, ExperimentView, ResultView, Tone } from "./live/view"

export type SampleScenario = keyof typeof scenarios

const ROWS: Record<SampleScenario, BehaviorRow[]> = {
  accepted: [
    ["Reached the goal", "6 of 12", "8 of 12", "2 more", "good"],
    ["Went back to compare plans", "5 trials", "2 trials", "3 fewer", "good"],
    ["Opened the paid-trial dialog", "4 trials", "1 trial", "3 fewer", "good"],
    ["Steps needed when successful", "14", "11", "3 fewer", "good"],
  ],
  inconclusive: [
    ["Reached the goal", "6 of 12", "7 of 12", "1 more", "warn"],
    ["Went back to compare plans", "5 trials", "4 trials", "1 fewer", "warn"],
    ["Opened the paid-trial dialog", "4 trials", "3 trials", "1 fewer", "warn"],
    ["Steps needed when successful", "14", "13", "1 fewer", "warn"],
  ],
  rejected: [
    ["Reached the goal", "6 of 12", "9 of 12", "3 more", "good"],
    ["Started a paid trial by mistake", "0 trials", "3 trials", "Unsafe", "bad"],
    ["Went back to compare plans", "5 trials", "2 trials", "3 fewer", "good"],
    ["Steps needed when successful", "14", "10", "4 fewer", "good"],
  ],
  empty: [
    ["Reached the goal", "6 of 12", "N/A", "No data", "muted"],
    ["Went back to compare plans", "5 trials", "N/A", "No data", "muted"],
    ["Opened the paid-trial dialog", "4 trials", "N/A", "No data", "muted"],
    ["Steps needed when successful", "14", "N/A", "No data", "muted"],
  ],
}

export function sampleResult(scenario: SampleScenario): ResultView {
  const s = scenarios[scenario]
  return {
    label: s.label,
    tone: s.tone as Tone,
    reason: s.reason,
    baselineRate: "50%",
    candidateRate: s.rate,
    improvement: s.improvement,
    guardrail: s.guardrail as ResultView["guardrail"],
    failedGuardrails: s.guardrail === "Failed" ? ["Plan rules: a paid trial was started"] : [],
    rows: ROWS[scenario],
    validTrials: "12 valid trials per version",
    infraErrors: scenario === "empty" ? 9 : 1,
    cancelled: scenario === "empty" ? 3 : 0,
  }
}

export const sampleSummaries: ExperimentSummary[] = [
  { id: experiment.id, name: experiment.name, statusLabel: experiment.status, statusTone: "good", updatedAt: "Today, 10:42" },
]

/** The sample experiment at a point in the demo flow, in the same shape the live screens read. */
export function sampleView(opts: {
  progress: number
  cancelled: boolean
  selectedPatches: string[]
  candidateProgress: number
  scenario: SampleScenario
}): ExperimentView {
  const done = opts.progress === 100
  const shown = runs.map((r) => ({ ...r, tone: r.tone as Tone, running: false, illustrative: r.screenshot }))
  return {
    id: experiment.id,
    name: experiment.name,
    task: experiment.task,
    state: done ? "awaiting_approval" : "baseline_running",
    statusLabel: opts.cancelled ? "Cancelled" : done ? "First test complete" : `Running · ${opts.progress}%`,
    statusTone: opts.cancelled ? "bad" : done ? "good" : "coral",
    stage: done ? 2 : 0,
    round: 1,
    incumbentVersionId: "ver_original_01",
    maxSteps: 25,
    cancelRequested: opts.cancelled,
    stopped: opts.cancelled,
    baseline: {
      planned: 12,
      completed: done ? 12 : Math.round((opts.progress / 100) * 12),
      progress: opts.progress,
      runs: shown,
      successes: 6,
      behavioralFailures: 5,
      infraErrors: 1,
      cancelled: opts.cancelled ? 1 : 0,
      medianStepsToSuccess: 14,
      stoppedEarly: false,
    },
    candidateBatch: {
      planned: 12,
      completed: Math.round((opts.candidateProgress / 100) * 12),
      progress: opts.candidateProgress,
      runs: [],
      successes: 0,
      behavioralFailures: 0,
      infraErrors: 0,
      cancelled: 0,
      medianStepsToSuccess: null,
      stoppedEarly: false,
    },
    observations: observations.map((o, i) => ({
      id: o.id,
      text: o.text,
      refs: o.refs,
      share: i === 0 ? "42% of trials" : "33% of trials",
      disposition: "unreviewed",
    })),
    patches: patches.map((p, i) => ({
      id: p.id,
      target: p.target,
      before: p.before,
      after: p.after,
      support: p.support,
      hypothesis: p.hypothesis,
      risk: p.risk,
      tone: p.risk.startsWith("Low") ? "good" : "warn",
      blocked: false,
      correspondence: p.correspondence,
      observationIds: [observations[i]?.id ?? ""],
    })),
    awaitingApproval: done && !opts.cancelled,
    update: opts.candidateProgress < 100 ? { progress: opts.candidateProgress, label: "Testing the update" } : undefined,
    results: sampleResult(opts.scenario),
    candidate: {
      id: "cand_sample",
      reviewStatus: "pending",
      url: "",
      applied: opts.selectedPatches.map((id) => patches.find((p) => p.id === id)?.after ?? id),
      canPromote: opts.scenario === "accepted",
      canDiscard: true,
    },
  }
}
