import { describe, expect, it } from "vitest"
import type { AgentActionEvent, Evaluation, Experiment, MutationPatch, ObservationTrend, RunMetrics } from "@ghostloop/contracts"
import { emptySnapshot, readSnapshot, type Snapshot, type StoredRun } from "../src/live/snapshot"
import { experimentView, resultView, summaries, type Element } from "../src/live/view"

const T = "2026-10-24T10:00:00.000Z"

function experiment(over: Partial<Experiment> = {}): Experiment {
  return {
    schemaVersion: "1.0.0",
    id: "exp_a",
    protocol: {
      schemaVersion: "1.0.0",
      id: "proto_a",
      experimentId: "exp_a",
      baseVersionId: "ver_baseline",
      task: "Create a workspace on the free plan.",
      hiddenGoalRef: "goal.onboarding.free-plan",
      allowedPaths: [],
      intentConstraints: [],
      protectedElements: [],
      protectedCategories: [],
      approvedStyleTokens: [],
      mode: "manual",
      scenarios: [{ id: "scn_a", name: "A", description: "", inputs: {}, runs: 4 }],
      budgets: { maxActionsPerRun: 8, runsPerBatch: 4, maxConcurrency: 2, maxIterations: 1, maxCandidates: 1, maxInferenceUsd: 5, maxWallClockMs: 60000 },
      policy: { targetCompletionRate: 0.8, minImprovementPp: 10, maxMedianActionsIncrease: 2, maxValidationErrorRateIncreasePp: 15, minValidFraction: 0.75, minValidPerScenario: 1 },
      frozenAt: T,
    },
    state: "awaiting_approval",
    incumbentVersionId: "ver_baseline",
    round: { index: 1, baselineBatchId: "batch_base", packetId: "pkt_1", analysisAttempts: 1 },
    transitions: [{ from: "created", to: "baseline_running", at: T }],
    usage: { inferenceCalls: 0, inferenceUsd: 0, wallClockMs: 0 },
    cancelRequested: false,
    ...over,
  }
}

function run(runId: `run_${string}`, outcome: StoredRun["outcome"], startedAt: string, stepCount = 5): StoredRun {
  return {
    schemaVersion: "1.0.0",
    runId,
    experimentId: "exp_a",
    protocolId: "proto_a",
    versionId: "ver_baseline",
    scenarioId: "scn_a",
    batchId: "batch_base",
    goalVerified: outcome === "goal",
    stepCount,
    outcome,
    terminalScreen: "done",
    screenshots: [],
    behaviorallyValid: !["model_error", "browser_error", "user_cancelled"].includes(outcome),
    startedAt,
    endedAt: startedAt,
  }
}

function action(runId: `run_${string}`, seq: number, over: Partial<AgentActionEvent> = {}): AgentActionEvent {
  return {
    runId,
    seq,
    at: `2026-10-24T10:00:0${seq}.000Z`,
    batchId: "batch_base",
    versionId: "ver_baseline",
    screenBefore: "plan",
    screenAfter: "invite",
    action: { type: "click", elementId: "plan.free.cta" },
    result: "ok",
    viewport: { width: 1280, height: 800 },
    ...over,
  }
}

function observation(over: Partial<ObservationTrend> = {}): ObservationTrend {
  return {
    schemaVersion: "1.0.0",
    id: "obs_1",
    experimentId: "exp_a",
    versionId: "ver_baseline",
    batchId: "batch_base",
    kind: "screen_revisit",
    statement: "2 of 4 runs revisited plan.",
    numerator: 2,
    denominator: 4,
    traceRefs: [{ runId: "run_b" }, { runId: "run_b" }, { runId: "run_c" }],
    screens: ["plan"],
    elementIds: ["plan.free.cta"],
    disposition: "unreviewed",
    fingerprint: "fp1",
    ...over,
  }
}

function patch(over: Partial<MutationPatch> = {}): MutationPatch {
  return {
    schemaVersion: "1.0.0",
    id: "pat_1",
    experimentId: "exp_a",
    round: 1,
    sourceVersionId: "ver_baseline",
    targetElementId: "plan.free.cta",
    observationIds: ["obs_1"],
    rationale: "Naming the plan may reduce doubt.",
    risk: "low",
    state: "proposed",
    op: "set_label",
    value: "Continue with Free",
    ...over,
  } as MutationPatch
}

const elements = new Map<string, Element>([
  ["plan.free.cta", { elementId: "plan.free.cta", screen: "plan", role: "button", label: "Continue", protected: false, categories: [], supportedOps: ["set_label"] }],
])

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return { ...emptySnapshot(), experiments: [experiment()], ...over }
}

describe("readSnapshot", () => {
  const rows = <T,>(xs: T[]) => ({ iter: () => xs[Symbol.iterator]() as IterableIterator<T> })
  const none = rows<never>([])
  const source = (experimentRows: { id: string; json: string }[]) => ({
    experiment: rows(experimentRows),
    designVersion: none,
    batch: none,
    agentRun: none,
    agentAction: none,
    observation: none,
    hypothesis: none,
    packet: none,
    patch: none,
    candidate: none,
    validation: none,
    evaluation: none,
  })

  it("parses valid rows and reports invalid ones instead of throwing", () => {
    const s = readSnapshot(source([
      { id: "exp_a", json: JSON.stringify(experiment()) },
      { id: "exp_bad", json: "{not json" },
    ]))
    expect(s.experiments.map((e) => e.id)).toEqual(["exp_a"])
    expect(s.invalid).toHaveLength(1)
    expect(s.invalid[0]).toContain("experiment exp_bad")
  })
})

describe("experimentView", () => {
  it("returns undefined for an unknown experiment", () => {
    expect(experimentView(snap(), "exp_missing", {})).toBeUndefined()
  })

  it("labels finished runs in start order, then streaming runs, and counts outcomes", () => {
    const v = experimentView(
      snap({
        runs: [run("run_c", "step_limit", "2026-10-24T10:02:00.000Z"), run("run_b", "goal", "2026-10-24T10:01:00.000Z", 6), run("run_d", "browser_error", "2026-10-24T10:03:00.000Z")],
        actions: [action("run_b", 1), action("run_b", 0, { action: { type: "type", elementId: "signup.email", value: "x" }, screenAfter: "plan" }), action("run_e", 0)],
      }),
      "exp_a",
      {},
      elements,
    )!
    expect(v.baseline.runs.map((r) => [r.label, r.id, r.outcome, r.tone])).toEqual([
      ["Trial 01", "run_b", "Goal verified", "good"],
      ["Trial 02", "run_c", "Action limit reached", "warn"],
      ["Trial 03", "run_d", "Browser/model error", "muted"],
      ["Trial 04", "run_e", "In progress", "coral"],
    ])
    // 3 finished + 1 streaming run with 1 of 8 expected steps: (3 + 1/8) / 4
    expect(v.baseline).toMatchObject({ planned: 4, completed: 3, progress: 78, successes: 1, behavioralFailures: 1, infraErrors: 1, cancelled: 0, medianStepsToSuccess: 6 })
    expect(v.baseline.runs[0]!.actions).toEqual([
      { action: "Typed into", target: "signup.email", result: "Done on plan" },
      { action: "Clicked", target: "Continue", result: "Moved to invite" },
    ])
  })

  it("estimates progress from streamed actions, capping a running trial below done", () => {
    const acts = (runId: `run_${string}`, n: number) => Array.from({ length: n }, (_, i) => action(runId, i))
    const v = experimentView(snap({ actions: [...acts("run_x", 2), ...acts("run_y", 20)] }), "exp_a", {})!
    // planned 4, maxSteps 8: run_x 2/8, run_y capped at 0.95
    expect(v.baseline.progress).toBe(Math.round(((2 / 8 + 0.95) / 4) * 100))
    expect(v.baseline.completed).toBe(0)
  })

  it("maps the update phases onto one steadily advancing bar", () => {
    const at = (state: Experiment["state"], over: Partial<Snapshot> = {}) =>
      experimentView(snap({ experiments: [experiment({ state, round: { index: 1, baselineBatchId: "batch_base", candidateBatchId: "batch_cand", approvalId: "appr_1", analysisAttempts: 1 } })], ...over }), "exp_a", {})!.update
    expect(at("awaiting_approval")).toBeUndefined()
    expect(at("patching")).toEqual({ progress: 5, label: "Building the updated version" })
    expect(at("validating")).toEqual({ progress: 12, label: "Checking the updated version" })
    expect(at("candidate_running")).toEqual({ progress: 15, label: "Testing the update · 0 of 4 trials finished" })
    // Candidate trials are judged against the baseline's median steps to success (6 here), not the step limit.
    const running = at("candidate_running", {
      runs: [run("run_b", "goal", "2026-10-24T10:01:00.000Z", 6)],
      actions: [0, 1, 2].map((i) => action("run_c", i, { batchId: "batch_cand" })),
    })
    expect(running).toEqual({ progress: 15 + Math.round(0.8 * Math.round((3 / 6 / 4) * 100)), label: "Testing the update · 0 of 4 trials finished" })
    expect(at("comparing")).toEqual({ progress: 97, label: "Comparing results" })
  })

  it("labels trials stopped by the batch, not the designer, as stopped early, and flags the batch", () => {
    const batch = { batchId: "batch_base", experimentId: "exp_a", versionId: "ver_baseline", phase: "baseline" as const, round: 1, plannedRuns: 4, cancelled: true, usage: { inferenceCalls: 0, inferenceUsd: 0, wallClockMs: 0 }, superseded: false }
    const runs = [run("run_b", "goal", "2026-10-24T10:01:00.000Z"), run("run_c", "user_cancelled", "2026-10-24T10:02:00.000Z")]
    const early = experimentView(snap({ batches: [batch as never], runs }), "exp_a", {})!
    expect(early.baseline.runs.map((r) => r.outcome)).toEqual(["Goal verified", "Stopped early"])
    expect(early.baseline.stoppedEarly).toBe(true)
    const byDesigner = experimentView(snap({ experiments: [experiment({ cancelRequested: true })], batches: [batch as never], runs }), "exp_a", {})!
    expect(byDesigner.baseline.runs[1]!.outcome).toBe("Cancelled")
    expect(byDesigner.baseline.stoppedEarly).toBe(false)
  })

  it("shows the judge's verdict and explanation on judged trials", () => {
    const judged = (outcome: StoredRun["outcome"], judge: { reached: boolean | "uncertain" }, extra: object = {}) =>
      ({ ...run("run_b", outcome, "2026-10-24T10:01:00.000Z"), judge: { explanation: "No dashboard page exists.", evidence: [], model: "m", instructionVersion: "v", usd: 0.03, ...judge }, ...extra }) as StoredRun
    const view = (r: StoredRun) => experimentView(snap({ runs: [r] }), "exp_a", {})!.baseline.runs[0]!
    expect(view(judged("goal", { reached: true }))).toMatchObject({ outcome: "Goal verified", tone: "good", verdict: "No dashboard page exists." })
    expect(view(judged("agent_stop", { reached: false }))).toMatchObject({ outcome: "Goal not reached", tone: "warn" })
    expect(view(judged("step_limit", { reached: "uncertain" }))).toMatchObject({ outcome: "Judge unsure", tone: "warn" })
    const blocked = view({ ...run("run_b", "flow_blocked", "2026-10-24T10:01:00.000Z"), protectedViolation: "no_paid_trial" } as StoredRun)
    expect(blocked).toMatchObject({ outcome: "Broke a protected rule (no paid trial)", tone: "bad" })
    expect(view(run("run_b", "agent_stop", "2026-10-24T10:01:00.000Z")).verdict).toBeUndefined()
  })

  it("labels a scripted scenario stop apart from the model giving up", () => {
    const stop = (source: "model" | "scenario") => action("run_b", 0, { decisionSource: source, action: { type: "stop", reason: "done" } })
    const scripted = experimentView(snap({ runs: [run("run_b", "agent_stop", "2026-10-24T10:01:00.000Z")], actions: [stop("scenario")] }), "exp_a", {})!
    expect(scripted.baseline.runs[0]!.outcome).toBe("Gave up (scenario rule)")
    const model = experimentView(snap({ runs: [run("run_b", "agent_stop", "2026-10-24T10:01:00.000Z")], actions: [stop("model")] }), "exp_a", {})!
    expect(model.baseline.runs[0]!.outcome).toBe("Gave up")
  })

  it("flags steps that hit a validation error or failed, with the message, and counts them per trial", () => {
    const v = experimentView(
      snap({
        actions: [
          action("run_x", 0),
          action("run_x", 1, { result: "validation_error", screenAfter: "invite", validationFeedback: ["Enter a valid email address"] }),
          action("run_x", 2, { result: "no_effect", screenAfter: "invite" }),
          action("run_x", 3, { result: "execution_error", error: "Element detached" }),
        ],
      }),
      "exp_a",
      {},
    )!
    const steps = v.baseline.runs[0]!.actions
    expect(steps.map((a) => a.flag)).toEqual([undefined, "Enter a valid email address", "No visible change", "Element detached"])
    expect(v.baseline.runs[0]!.issues).toBe(3)
  })

  it("describes non-ok results and stop reasons", () => {
    const v = experimentView(
      snap({
        actions: [
          action("run_x", 0, { result: "validation_error", screenAfter: "plan" }),
          action("run_x", 1, { action: { type: "stop", reason: "I can't find the free plan" } }),
        ],
      }),
      "exp_a",
      {},
    )!
    expect(v.baseline.runs[0]!.actions.map((a) => a.result)).toEqual(["Validation error shown", "I can't find the free plan"])
    expect(v.baseline.runs[0]!.actions[1]!.target).toBe("Session")
  })

  it("keeps only screenshots the browser can load", () => {
    const v = experimentView(
      snap({
        actions: [
          action("run_x", 0, { screenshot: { uri: "artifacts/run_x/0.png", width: 1, height: 1 } }),
          action("run_x", 1, { screenshot: { uri: "/artifacts/run_x/1.png", width: 1, height: 1 } }),
        ],
      }),
      "exp_a",
      {},
    )!
    expect(v.baseline.runs[0]!.actions.map((a) => a.screenshot)).toEqual([undefined, "/artifacts/run_x/1.png"])
  })

  it("links observations to trial labels and shows their share", () => {
    const v = experimentView(snap({ runs: [run("run_b", "goal", "2026-10-24T10:01:00.000Z"), run("run_c", "goal", "2026-10-24T10:02:00.000Z")], observations: [observation()] }), "exp_a", {})!
    expect(v.observations).toEqual([{ id: "obs_1", text: "2 of 4 runs revisited plan.", refs: "Trials 01, 02", share: "50% of trials", disposition: "unreviewed" }])
  })

  it("shows the current round's patches with before/after from the manifest", () => {
    const v = experimentView(
      snap({
        observations: [observation()],
        patches: [patch(), patch({ id: "pat_old", round: 0 }), patch({ id: "pat_2", risk: "blocked", state: "blocked", blockReason: "protected element" })],
      }),
      "exp_a",
      {},
      elements,
    )!
    expect(v.patches.map((p) => p.id)).toEqual(["pat_1", "pat_2"])
    expect(v.patches[0]).toMatchObject({
      target: "Label · Continue",
      before: "Continue",
      after: "Continue with Free",
      support: "2 of 4 runs revisited plan.",
      hypothesis: "Naming the plan may reduce doubt.",
      risk: "Low risk",
      tone: "good",
      blocked: false,
      correspondence: "Not linked",
    })
    expect(v.patches[1]).toMatchObject({ risk: "Blocked · protected element", tone: "bad", blocked: true })
    expect(v.awaitingApproval).toBe(true)
    expect(v.stage).toBe(2)
  })

  it("is not awaiting approval once a cancel is requested or the round is approved", () => {
    expect(experimentView(snap({ experiments: [experiment({ cancelRequested: true })] }), "exp_a", {})!.awaitingApproval).toBe(false)
    expect(
      experimentView(snap({ experiments: [experiment({ round: { index: 1, approvalId: "appr_1", analysisAttempts: 1 } })] }), "exp_a", {})!.awaitingApproval,
    ).toBe(false)
  })

  it("uses the designer's name when one was saved, else the task", () => {
    expect(experimentView(snap(), "exp_a", { exp_a: "Free plan onboarding" })!.name).toBe("Free plan onboarding")
    expect(experimentView(snap(), "exp_a", {})!.name).toBe("Create a workspace on the free plan.")
  })

  it("labels a stopped experiment by its stopping reason", () => {
    const stopped = experiment({
      state: "stopped",
      stopping: { reason: "USER_STOP", at: T, bestVersionId: "ver_baseline", attemptedCandidateIds: [], evaluationIds: [], rejectedPatchIds: [], remainingObservationIds: [] },
    })
    const v = experimentView(snap({ experiments: [stopped] }), "exp_a", {})!
    expect([v.statusLabel, v.stopped]).toEqual(["Stopped by you", true])
  })

  it("offers promotion only for a pending candidate with an accepted evaluation", () => {
    const candidate = {
      schemaVersion: "1.0.0" as const,
      id: "cand_1" as const,
      versionId: "ver_c1" as const,
      parentVersionId: "ver_baseline" as const,
      patchIds: ["pat_1" as const],
      url: "http://localhost:5173/v/ver_c1/signup",
      reviewStatus: "pending" as const,
      createdAt: T,
    }
    const exp = experiment({ state: "accepted", round: { index: 1, candidateId: "cand_1", evaluationId: "eval_1", analysisAttempts: 1 } })
    const accepted = evaluation({ decision: "accepted" })
    const v = experimentView(snap({ experiments: [exp], candidates: [candidate], evaluations: [accepted], patches: [patch()] }), "exp_a", {}, elements)!
    expect(v.candidate).toMatchObject({ id: "cand_1", applied: ["Continue with Free"], canPromote: true, canDiscard: true })
    const rejected = experimentView(snap({ experiments: [exp], candidates: [candidate], evaluations: [evaluation({ decision: "rejected" })] }), "exp_a", {})!
    expect(rejected.candidate).toMatchObject({ canPromote: false, canDiscard: true })
    const promoted = experimentView(snap({ experiments: [exp], candidates: [{ ...candidate, reviewStatus: "promoted_measured" }], evaluations: [accepted] }), "exp_a", {})!
    expect(promoted.candidate).toMatchObject({ canPromote: false, canDiscard: false })
  })
})

function metrics(over: Partial<RunMetrics> = {}): RunMetrics {
  return {
    versionId: "ver_baseline",
    batchId: "batch_base",
    plannedRuns: 12,
    validRuns: 12,
    successes: 6,
    completionRate: 0.5,
    outcomeCounts: { goal: 6, agent_stop: 2, step_limit: 2, flow_blocked: 2, model_error: 0, browser_error: 0, user_cancelled: 0 },
    infraErrors: 1,
    cancelled: 0,
    medianActionsToSuccess: 14,
    backtrackRuns: 5,
    validationErrorRuns: 2,
    perScenario: [],
    complete: true,
    ...over,
  }
}

function evaluation(over: Partial<Evaluation> = {}): Evaluation {
  return {
    schemaVersion: "1.0.0",
    id: "eval_1",
    experimentId: "exp_a",
    protocolId: "proto_a",
    baselineVersionId: "ver_baseline",
    candidateVersionId: "ver_c1",
    baseline: metrics(),
    candidate: metrics({ versionId: "ver_c1", batchId: "batch_cand", successes: 8, completionRate: 8 / 12, medianActionsToSuccess: 11, backtrackRuns: 2, infraErrors: 0 }),
    guardrails: [{ name: "protected elements unchanged", passed: true }],
    deltaPp: 16.666,
    decision: "accepted",
    reasons: ["Improvement exceeds the 10 pp minimum."],
    at: T,
    ...over,
  }
}

describe("resultView", () => {
  it("summarises an accepted comparison", () => {
    const r = resultView(evaluation())
    expect(r).toMatchObject({
      label: "Accepted",
      tone: "good",
      baselineRate: "50%",
      candidateRate: "66.7%",
      improvement: "+16.7 pp",
      guardrail: "Passed",
      failedGuardrails: [],
      reason: "Improvement exceeds the 10 pp minimum.",
      infraErrors: 1,
      cancelled: 0,
    })
    expect(r.rows).toEqual([
      ["Reached the goal", "6 of 12", "8 of 12", "2 more", "good"],
      ["Went back to an earlier screen", "5 trials", "2 trials", "3 fewer", "good"],
      ["Hit a validation error", "2 trials", "2 trials", "No change", "muted"],
      ["Steps needed when successful", "14", "11", "3 fewer", "good"],
    ])
  })

  it("reports failed guardrails on a rejection", () => {
    const r = resultView(evaluation({ decision: "rejected", guardrails: [{ name: "plan rules", passed: false, detail: "paid trial started" }] }))
    expect(r).toMatchObject({ label: "Rejected", tone: "bad", guardrail: "Failed", failedGuardrails: ["plan rules: paid trial started"] })
  })

  it("shows no valid sessions when the candidate has none", () => {
    const r = resultView(evaluation({ decision: "inconclusive", candidate: null, deltaPp: null }))
    expect(r).toMatchObject({ label: "No valid sessions", tone: "muted", candidateRate: "N/A", improvement: "N/A" })
    expect(r.rows.every((row) => row[3] === "No data")).toBe(true)
  })
})

describe("summaries", () => {
  it("lists experiments newest first with their status", () => {
    const older = experiment({ id: "exp_old", transitions: [{ from: "created", to: "baseline_running", at: "2026-10-23T10:00:00.000Z" }] })
    const s = summaries(snap({ experiments: [older, experiment()] }), { exp_a: "Onboarding" })
    expect(s.map((x) => [x.id, x.name, x.statusLabel])).toEqual([
      ["exp_a", "Onboarding", "Waiting for your review"],
      ["exp_old", "Create a workspace on the free plan.", "Waiting for your review"],
    ])
  })
})
