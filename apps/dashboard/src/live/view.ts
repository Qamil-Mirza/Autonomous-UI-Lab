import type {
  ActionResult,
  AgentActionEvent,
  BatchRecord,
  Evaluation,
  Experiment,
  ExperimentState,
  ManifestElement,
  MutationPatch,
  ObservationDisposition,
  RunMetrics,
  RunOutcome,
  StoppingReason,
} from "@ghostloop/contracts"
import type { Snapshot, StoredRun } from "./snapshot"

export type Tone = "good" | "warn" | "bad" | "muted" | "coral"

/** A manifest element plus the presentation fields the prototype's manifests also carry. */
export type Element = ManifestElement & { order?: number; styleToken?: string }
export type Elements = ReadonlyMap<string, Element>

export interface ActionView {
  action: string
  target: string
  result: string
  screenshot?: string
}

export interface RunView {
  id: string
  label: string
  outcome: string
  tone: Tone
  running: boolean
  actions: ActionView[]
  /** Sample data only: plays the illustrative replay instead of real screenshots. */
  illustrative?: boolean
}

export interface BatchView {
  batchId?: string
  planned: number
  completed: number
  /**
   * 0-100. Finished runs count fully; a running one counts its actions over the steps a trial is expected to take,
   * capped below done, so the bar moves while parallel trials are still going.
   */
  progress: number
  runs: RunView[]
  successes: number
  behavioralFailures: number
  infraErrors: number
  cancelled: number
  medianStepsToSuccess: number | null
  /** The simulator stopped the batch before all trials ran (error streak, time or call limit), not the designer. */
  stoppedEarly: boolean
}

export interface ObservationView {
  id: string
  text: string
  refs: string
  share: string
  disposition: ObservationDisposition
}

export interface PatchView {
  id: string
  target: string
  before: string
  after: string
  support: string
  hypothesis: string
  risk: string
  tone: Tone
  blocked: boolean
  correspondence: string
  observationIds: string[]
  /** Screen the target element is on (from the manifest), for opening previews there. */
  screen?: string
  /** The stored patch, for building a preview; absent for sample data. */
  raw?: MutationPatch
}

export type BehaviorRow = [label: string, original: string, updated: string, difference: string, tone: Tone]

export interface ResultView {
  label: string
  tone: Tone
  reason: string
  baselineRate: string
  candidateRate: string
  improvement: string
  guardrail: "Passed" | "Failed" | "Not evaluated"
  failedGuardrails: string[]
  rows: BehaviorRow[]
  validTrials: string
  infraErrors: number
  cancelled: number
}

export interface CandidateView {
  id: string
  reviewStatus: string
  url: string
  applied: string[]
  canPromote: boolean
  canDiscard: boolean
}

export interface ExperimentView {
  id: string
  name: string
  task: string
  state: ExperimentState
  statusLabel: string
  statusTone: Tone
  /** Index into the dashboard's five stages: first test, what happened, review, test the update, compare. */
  stage: number
  round: number
  incumbentVersionId: string
  incumbentUrl?: string
  maxSteps: number
  cancelRequested: boolean
  stopped: boolean
  baseline: BatchView
  candidateBatch?: BatchView
  observations: ObservationView[]
  patches: PatchView[]
  awaitingApproval: boolean
  /** While the approved update is built, checked, tested and compared: one bar across those phases. */
  update?: { progress: number; label: string }
  results?: ResultView
  candidate?: CandidateView
}

export interface ExperimentSummary {
  id: string
  name: string
  statusLabel: string
  statusTone: Tone
  updatedAt: string
}

const STAGE: Record<ExperimentState, number> = {
  created: 0,
  baseline_running: 0,
  observing: 1,
  diagnosing: 1,
  proposing: 1,
  awaiting_approval: 2,
  patching: 3,
  validating: 3,
  candidate_running: 3,
  comparing: 4,
  accepted: 4,
  rejected: 4,
  inconclusive: 4,
  stopped: 4,
}

const STATE_LABEL: Record<ExperimentState, [string, Tone]> = {
  created: ["Not started", "muted"],
  baseline_running: ["Running the first test", "coral"],
  observing: ["Analyzing the trials", "coral"],
  diagnosing: ["Analyzing the trials", "coral"],
  proposing: ["Preparing suggestions", "coral"],
  awaiting_approval: ["Waiting for your review", "warn"],
  patching: ["Building the update", "coral"],
  validating: ["Checking the update", "coral"],
  candidate_running: ["Testing the update", "coral"],
  comparing: ["Comparing results", "coral"],
  accepted: ["Accepted", "good"],
  rejected: ["Rejected", "bad"],
  inconclusive: ["Inconclusive", "warn"],
  stopped: ["Stopped", "muted"],
}

const STOP_LABEL: Record<StoppingReason, string> = {
  TARGET_MET: "Target met",
  ITERATION_BUDGET: "Round limit reached",
  COST_BUDGET: "Cost limit reached",
  TIME_BUDGET: "Time limit reached",
  NO_VALID_PATCH: "No usable suggestion",
  NO_MEASURED_IMPROVEMENT: "No measured improvement",
  INCONCLUSIVE: "Inconclusive",
  USER_STOP: "Stopped by you",
  INTEGRATION_FAILURE: "Stopped: integration failure",
}

export function statusOf(e: Experiment): [string, Tone] {
  if (e.state === "stopped" || e.stopping) {
    const reason = e.stopping?.reason
    if (!reason) return STATE_LABEL.stopped
    return [STOP_LABEL[reason], reason === "INTEGRATION_FAILURE" ? "bad" : reason === "TARGET_MET" ? "good" : "muted"]
  }
  if (e.cancelRequested) return ["Stopping…", "muted"]
  return STATE_LABEL[e.state]
}

const OUTCOME: Record<RunOutcome, [string, Tone]> = {
  goal: ["Goal verified", "good"],
  agent_stop: ["Gave up", "warn"],
  step_limit: ["Action limit reached", "warn"],
  flow_blocked: ["Product flow blocked", "bad"],
  model_error: ["Browser/model error", "muted"],
  browser_error: ["Browser/model error", "muted"],
  user_cancelled: ["Cancelled", "muted"],
}

const VERB = { click: "Clicked", type: "Typed into", select: "Selected", stop: "Stopped" } as const

const RESULT: Record<Exclude<ActionResult, "ok">, string> = {
  validation_error: "Validation error shown",
  no_effect: "No visible change",
  rejected_invalid: "Action rejected as invalid",
  execution_error: "Action failed",
  observation_error: "Could not read the page",
}

const isUrl = (uri: string) => /^(https?:\/\/|\/|data:image\/)/.test(uri)

export function actionView(e: AgentActionEvent, elements: Elements): ActionView {
  const { action } = e
  const target =
    action.type === "stop"
      ? "Session"
      : action.elementId
        ? (elements.get(action.elementId)?.label || action.elementId)
        : "Page"
  let result: string
  if (action.type === "stop") result = action.reason || "Ended the session"
  else if (e.result !== "ok") result = e.result === "execution_error" && e.error ? e.error : RESULT[e.result]
  else result = e.screenAfter !== e.screenBefore ? `Moved to ${e.screenAfter}` : `Done on ${e.screenAfter}`
  const shot = e.screenshot?.uri ?? e.screenshotBefore?.uri
  return { action: VERB[action.type], target, result, ...(shot && isUrl(shot) ? { screenshot: shot } : {}) }
}

const pad = (n: number) => String(n).padStart(2, "0")

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

/** Finished runs from `agent_run`, plus runs still streaming actions, in start order. */
export function batchView(
  batch: { batchId?: string; planned: number; expectedSteps: number; cancelled?: boolean; cancelRequested?: boolean },
  snap: Snapshot,
  elements: Elements,
  labels: Map<string, string>,
): BatchView {
  const finished = snap.runs
    .filter((r) => batch.batchId !== undefined && r.batchId === batch.batchId)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.runId.localeCompare(b.runId))
  const finishedIds = new Set<string>(finished.map((r) => r.runId))
  const actionsByRun = new Map<string, AgentActionEvent[]>()
  for (const a of snap.actions) {
    const list = actionsByRun.get(a.runId) ?? []
    list.push(a)
    actionsByRun.set(a.runId, list)
  }
  const streaming = [...actionsByRun.entries()]
    .filter(([runId, acts]) => !finishedIds.has(runId) && batch.batchId !== undefined && acts.some((a) => a.batchId === batch.batchId))
    .sort(([, a], [, b]) => (a[0]?.at ?? "").localeCompare(b[0]?.at ?? ""))
    .map(([runId]) => runId)

  const actionsOf = (runId: string) =>
    (actionsByRun.get(runId) ?? []).sort((a, b) => a.seq - b.seq).map((a) => actionView(a, elements))

  const runs: RunView[] = [
    ...finished.map((r: StoredRun) => {
      let [outcome, tone] = OUTCOME[r.outcome]
      // Trials interrupted because the batch stopped were not cancelled by anyone.
      if (r.outcome === "user_cancelled" && !batch.cancelRequested) outcome = "Stopped early"
      // A scenario rule (e.g. low persistence) ended it, not the model's own decision.
      const last = (actionsByRun.get(r.runId) ?? []).reduce<AgentActionEvent | undefined>((a, b) => (!a || b.seq > a.seq ? b : a), undefined)
      if (r.outcome === "agent_stop" && last?.decisionSource === "scenario") outcome = "Gave up (scenario rule)"
      return { id: r.runId, label: "", outcome, tone, running: false, actions: actionsOf(r.runId) }
    }),
    ...streaming.map((runId) => ({ id: runId, label: "", outcome: "In progress", tone: "coral" as Tone, running: true, actions: actionsOf(runId) })),
  ].map((r, i) => {
    const label = `Trial ${pad(i + 1)}`
    labels.set(r.id, label)
    return { ...r, label }
  })

  const count = (pred: (r: StoredRun) => boolean) => finished.filter(pred).length
  const planned = Math.max(batch.planned, finished.length + streaming.length)
  const expected = Math.max(1, batch.expectedSteps)
  const done = finished.length + streaming.reduce((sum, runId) => sum + Math.min((actionsByRun.get(runId)?.length ?? 0) / expected, 0.95), 0)
  return {
    batchId: batch.batchId,
    planned,
    completed: finished.length,
    progress: planned === 0 ? 0 : Math.min(100, Math.round((done / planned) * 100)),
    runs,
    successes: count((r) => r.outcome === "goal"),
    behavioralFailures: count((r) => ["agent_stop", "step_limit", "flow_blocked"].includes(r.outcome)),
    infraErrors: count((r) => r.outcome === "model_error" || r.outcome === "browser_error"),
    cancelled: count((r) => r.outcome === "user_cancelled"),
    medianStepsToSuccess: median(finished.filter((r) => r.outcome === "goal").map((r) => r.stepCount)),
    stoppedEarly: Boolean(batch.cancelled) && !batch.cancelRequested,
  }
}

const OP_LABEL = { set_label: "Label", set_style_token: "Style", set_order: "Position", set_visibility: "Visibility" } as const
const RISK: Record<MutationPatch["risk"], [string, Tone]> = {
  low: ["Low risk", "good"],
  review_required: ["Review needed", "warn"],
  blocked: ["Blocked", "bad"],
  unknown: ["Risk unknown", "warn"],
}

function patchView(p: MutationPatch, elements: Elements, snap: Snapshot, figma: string): PatchView {
  const el = elements.get(p.targetElementId)
  const name = el?.label || p.targetElementId
  let before: string
  let after: string
  switch (p.op) {
    case "set_label":
      before = el?.label ?? "Current label"
      after = p.value
      break
    case "set_style_token":
      before = el?.styleToken ?? "Current style"
      after = p.value
      break
    case "set_order":
      before = el?.order !== undefined ? `Position ${el.order}` : "Current position"
      after = `Position ${p.value}`
      break
    case "set_visibility":
      before = el?.visible === false ? "Hidden" : "Visible"
      after = p.value ? "Visible" : "Hidden"
      break
  }
  const [risk, tone] = RISK[p.risk]
  const support = p.observationIds
    .map((id) => snap.observations.find((o) => o.id === id)?.statement)
    .filter((s): s is string => Boolean(s))
    .join(" · ")
  return {
    id: p.id,
    target: `${OP_LABEL[p.op]} · ${name}`,
    before,
    after,
    support: support || p.observationIds.join(", "),
    hypothesis: p.rationale,
    risk: p.risk === "blocked" && p.blockReason ? `${risk} · ${p.blockReason}` : risk,
    tone,
    blocked: p.state === "blocked" || p.risk === "blocked",
    correspondence: figma,
    observationIds: p.observationIds,
    ...(el?.screen ? { screen: el.screen } : {}),
    raw: p,
  }
}

const pct = (rate: number | null | undefined) =>
  rate === null || rate === undefined ? "N/A" : `${Math.round(rate * 1000) / 10}%`

function diff(base: number | null, cand: number | null, unit: { more: string; fewer: string }, fewerIsBetter: boolean): [string, Tone] {
  if (base === null || cand === null) return ["No data", "muted"]
  const d = Math.round((cand - base) * 10) / 10
  if (d === 0) return ["No change", "muted"]
  const better = fewerIsBetter ? d < 0 : d > 0
  return [`${Math.abs(d)} ${d > 0 ? unit.more : unit.fewer}`, better ? "good" : "warn"]
}

export function resultView(ev: Evaluation): ResultView {
  const b = ev.baseline
  const c: RunMetrics | null = ev.candidate
  const empty = !c || c.validRuns === 0
  const [label, tone]: [string, Tone] = empty
    ? ["No valid sessions", "muted"]
    : ev.decision === "accepted"
      ? ["Accepted", "good"]
      : ev.decision === "rejected"
        ? ["Rejected", "bad"]
        : ["Inconclusive", "warn"]
  const failed = ev.guardrails.filter((g) => !g.passed)
  const trials = (n: number) => `${n} trial${n === 1 ? "" : "s"}`
  const row = (
    name: string,
    base: number | null,
    cand: number | null,
    show: (n: number | null) => string,
    fewerIsBetter: boolean,
  ): BehaviorRow => {
    const [difference, t] = c ? diff(base, cand, { more: "more", fewer: "fewer" }, fewerIsBetter) : ["No data", "muted" as Tone]
    return [name, show(base), c ? show(cand) : "N/A", difference, t]
  }
  return {
    label,
    tone,
    reason: ev.reasons.join(" ") || (ev.stoppingReason ? STOP_LABEL[ev.stoppingReason] : ""),
    baselineRate: pct(b.completionRate),
    candidateRate: c ? pct(c.completionRate) : "N/A",
    improvement: ev.deltaPp === null ? "N/A" : `${ev.deltaPp > 0 ? "+" : ""}${Math.round(ev.deltaPp * 10) / 10} pp`,
    guardrail: ev.guardrails.length === 0 ? "Not evaluated" : failed.length ? "Failed" : "Passed",
    failedGuardrails: failed.map((g) => (g.detail ? `${g.name}: ${g.detail}` : g.name)),
    rows: [
      [
        "Reached the goal",
        `${b.successes} of ${b.validRuns}`,
        c ? `${c.successes} of ${c.validRuns}` : "N/A",
        ...(c ? diff(b.successes, c.successes, { more: "more", fewer: "fewer" }, false) : (["No data", "muted"] as [string, Tone])),
      ],
      row("Went back to an earlier screen", b.backtrackRuns, c?.backtrackRuns ?? null, (n) => (n === null ? "N/A" : trials(n)), true),
      row("Hit a validation error", b.validationErrorRuns, c?.validationErrorRuns ?? null, (n) => (n === null ? "N/A" : trials(n)), true),
      row("Steps needed when successful", b.medianActionsToSuccess, c?.medianActionsToSuccess ?? null, (n) => (n === null ? "N/A" : String(n)), true),
    ],
    validTrials: c ? `${b.validRuns} original · ${c.validRuns} updated valid trials` : `${b.validRuns} valid trials`,
    infraErrors: b.infraErrors + (c?.infraErrors ?? 0),
    cancelled: b.cancelled + (c?.cancelled ?? 0),
  }
}

const FIGMA_LABEL = { verified: "Verified", pending: "Pending", mismatch: "Mismatch", unavailable: "Unavailable" } as const

function updatedAt(e: Experiment): string {
  return e.transitions.at(-1)?.at ?? e.startedAt ?? e.protocol.frozenAt
}

export function summaries(snap: Snapshot, names: Record<string, string>): ExperimentSummary[] {
  return snap.experiments
    .map((e) => {
      const [statusLabel, statusTone] = statusOf(e)
      return { id: e.id, name: names[e.id] || e.protocol.task, statusLabel, statusTone, updatedAt: updatedAt(e) }
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** Building and checking take a fixed slice; the retest fills 15-95% by its own progress; comparing tops it off. */
function updateProgress(state: ExperimentState, batch: BatchView | undefined): ExperimentView["update"] {
  switch (state) {
    case "patching":
      return { progress: 5, label: "Building the updated version" }
    case "validating":
      return { progress: 12, label: "Checking the updated version" }
    case "candidate_running": {
      const b = batch ?? { progress: 0, completed: 0, planned: 0 }
      const label = b.planned ? `Testing the update · ${b.completed} of ${b.planned} trials finished` : "Testing the update"
      return { progress: 15 + Math.round(0.8 * b.progress), label }
    }
    case "comparing":
      return { progress: 97, label: "Comparing results" }
    default:
      return undefined
  }
}

function plannedOf(batch: BatchRecord | undefined, e: Experiment) {
  return batch?.plannedRuns ?? e.protocol.budgets.runsPerBatch
}

/**
 * Everything one experiment's screens show, derived from the snapshot. `elements` is the incumbent version's
 * manifest (for readable labels and before-values); without it, element IDs are shown.
 */
export function experimentView(
  snap: Snapshot,
  experimentId: string,
  names: Record<string, string>,
  elements: Elements = new Map(),
): ExperimentView | undefined {
  const e = snap.experiments.find((x) => x.id === experimentId)
  if (!e) return undefined
  const [statusLabel, statusTone] = statusOf(e)
  const r = e.round
  const findBatch = (id?: string) => (id ? snap.batches.find((b) => b.batchId === id) : undefined)
  const labels = new Map<string, string>()
  const baselineRecord = findBatch(r.baselineBatchId)
  const maxSteps = e.protocol.budgets.maxActionsPerRun
  const baseline = batchView(
    { batchId: r.baselineBatchId, planned: plannedOf(baselineRecord, e), expectedSteps: maxSteps, cancelled: baselineRecord?.cancelled, cancelRequested: e.cancelRequested },
    snap,
    elements,
    labels,
  )
  const candidateLabels = new Map<string, string>()
  const candidateRecord = findBatch(r.candidateBatchId)
  const candidateBatch = r.candidateBatchId
    ? batchView(
        {
          batchId: r.candidateBatchId,
          planned: plannedOf(candidateRecord, e),
          expectedSteps: baseline.medianStepsToSuccess ?? maxSteps,
          cancelled: candidateRecord?.cancelled,
          cancelRequested: e.cancelRequested,
        },
        snap,
        elements,
        candidateLabels,
      )
    : undefined

  const observations = snap.observations
    .filter((o) => o.experimentId === e.id && (!r.baselineBatchId || o.batchId === r.baselineBatchId))
    .map((o) => {
      const trials = [...new Set(o.traceRefs.map((t) => labels.get(t.runId)).filter((l): l is string => Boolean(l)))]
      return {
        id: o.id,
        text: o.statement,
        refs: trials.length ? `Trials ${trials.map((t) => t.replace("Trial ", "")).join(", ")}` : "",
        share: o.denominator ? `${Math.round((o.numerator / o.denominator) * 100)}% of trials` : "",
        disposition: o.disposition,
      }
    })

  const packet = r.packetId ? snap.packets.find((p) => p.id === r.packetId) : undefined
  const figma = packet?.figmaRef ? FIGMA_LABEL[packet.figmaRef.status] : "Not linked"
  const patches = snap.patches
    .filter((p) => p.experimentId === e.id && p.round === r.index)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p) => patchView(p, elements, snap, figma))

  const evaluation =
    (r.evaluationId && snap.evaluations.find((x) => x.id === r.evaluationId)) ||
    snap.evaluations.filter((x) => x.experimentId === e.id).sort((a, b) => b.at.localeCompare(a.at))[0]

  const cand =
    (r.candidateId && snap.candidates.find((c) => c.id === r.candidateId)) ||
    (evaluation && snap.candidates.find((c) => c.versionId === evaluation.candidateVersionId))
  const stopped = e.state === "stopped" || e.stopping !== undefined
  const candidate: CandidateView | undefined = cand
    ? {
        id: cand.id,
        reviewStatus: cand.reviewStatus,
        url: cand.url,
        applied: cand.patchIds.map((id) => {
          const p = snap.patches.find((x) => x.id === id)
          return p ? patchView(p, elements, snap, figma).after : id
        }),
        canPromote: cand.reviewStatus === "pending" && evaluation?.decision === "accepted" && evaluation.candidateVersionId === cand.versionId,
        canDiscard: cand.reviewStatus === "pending" && evaluation !== undefined,
      }
    : undefined

  return {
    id: e.id,
    name: names[e.id] || e.protocol.task,
    task: e.protocol.task,
    state: e.state,
    statusLabel,
    statusTone,
    stage: STAGE[e.state],
    round: r.index,
    incumbentVersionId: e.incumbentVersionId,
    incumbentUrl: snap.versions.find((v) => v.id === e.incumbentVersionId)?.url,
    maxSteps: e.protocol.budgets.maxActionsPerRun,
    cancelRequested: e.cancelRequested,
    stopped,
    baseline,
    candidateBatch,
    observations,
    patches,
    awaitingApproval: e.state === "awaiting_approval" && !e.cancelRequested && !r.approvalId,
    update: updateProgress(e.state, candidateBatch),
    results: evaluation ? resultView(evaluation) : undefined,
    candidate,
  }
}
