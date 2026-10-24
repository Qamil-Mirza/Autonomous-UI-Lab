// Deterministic generator for packages/contracts/fixtures/*.json.
// Usage: npm run fixtures:generate -w @ghostloop/contracts   (optional arg: output dir)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = process.argv[2] ?? fileURLToPath(new URL("../fixtures/", import.meta.url));
mkdirSync(join(OUT, "runs"), { recursive: true });
const P = "synthetic-fixture";
const SV = "1.0.0";
const write = (rel, obj) => writeFileSync(join(OUT, rel), JSON.stringify({ provenance: P, ...obj }, null, 2) + "\n");

const EXP = "exp_demo0001";
const PROTO = "proto_demo0001";
const VER_BASE = "ver_base0001";
const VER_CAND1 = "ver_cand0001";
const VER_CAND2 = "ver_cand0002";
const VER_CAND3 = "ver_cand0003";

const scenarios = [
  { id: "scn_baseline", name: "Baseline", description: "A new user signs up, names a workspace, picks the free plan, and finishes onboarding.",
    inputs: { email: "ada@example.com", password: "correct-horse-1", workspaceName: "Acme Research", inviteEmail: "grace@example.com" }, runs: 3 },
  { id: "scn_invalid_email", name: "Invalid invite email", description: "Same task, but the teammate email the user has on hand is malformed.",
    inputs: { email: "lin@example.com", password: "correct-horse-2", workspaceName: "Lin Labs", inviteEmail: "teammate@example" }, runs: 3 },
  { id: "scn_hesitant", name: "Hesitant evaluator", description: "A cautious user who wants to understand plan differences before committing.",
    inputs: { email: "sam@example.com", password: "correct-horse-3", workspaceName: "Sam & Co", inviteEmail: "kim@example.com" }, runs: 3 },
  { id: "scn_fast", name: "Fast path", description: "An experienced user who moves quickly and skips optional steps.",
    inputs: { email: "jo@example.com", password: "correct-horse-4", workspaceName: "Jo Ventures", inviteEmail: "max@example.com" }, runs: 3 },
];
const scn = Object.fromEntries(scenarios.map((s) => [s.id, s]));

const protocol = {
  schemaVersion: SV, id: PROTO, experimentId: EXP, baseVersionId: VER_BASE,
  task: "Create a workspace on the free plan and finish onboarding.",
  hiddenGoalRef: "goal.onboarding.free-plan",
  allowedPaths: ["/signup", "/workspace", "/plan", "/invite", "/done"],
  intentConstraints: [
    "Keep the free plan available and selectable.",
    "Do not change prices, signup fields, consent, or validation rules.",
    "Inviting a teammate stays optional.",
  ],
  protectedElements: ["signup.email", "signup.password", "signup.consent", "signup.submit", "plan.free.price", "plan.pro.price", "invite.email"],
  protectedCategories: ["signup", "pricing", "auth", "consent", "validation", "checker"],
  approvedStyleTokens: ["button.primary", "button.secondary", "emphasis.strong"],
  mode: "manual",
  scenarios,
  budgets: { maxActionsPerRun: 8, runsPerBatch: 12, maxConcurrency: 4, maxIterations: 3, maxCandidates: 3, maxInferenceUsd: 5, maxWallClockMs: 1800000 },
  policy: { targetCompletionRate: 0.8, minImprovementPp: 10, maxMedianActionsIncrease: 2, maxValidationErrorRateIncreasePp: 15, minValidFraction: 0.75, minValidPerScenario: 1 },
  frozenAt: "2026-10-23T09:00:00.000Z",
};
write("protocol.default.json", protocol);

// ---------- manifest ----------
const el = (elementId, screen, role, label, prot, categories, supportedOps) => ({ elementId, screen, role, label, protected: prot, categories, supportedOps });
const manifest = {
  schemaVersion: SV, versionId: VER_BASE, manifestHash: "sha256:fixture-base-0001",
  elements: [
    el("signup.email", "signup", "textbox", "Work email", true, ["signup"], []),
    el("signup.password", "signup", "textbox", "Password", true, ["auth"], []),
    el("signup.consent", "signup", "checkbox", "I agree to the Terms and Privacy Policy", true, ["consent"], []),
    el("signup.submit", "signup", "button", "Create account", true, ["signup"], []),
    el("workspace.name", "workspace", "textbox", "Workspace name", false, [], ["set_label"]),
    el("workspace.submit", "workspace", "button", "Continue", false, [], ["set_label", "set_style_token"]),
    el("plan.free.cta", "plan", "button", "Choose Free", false, [], ["set_label", "set_style_token"]),
    el("plan.pro.cta", "plan", "button", "Choose Pro", false, [], ["set_label", "set_style_token"]),
    el("plan.free.price", "plan", "text", "$0 / month", true, ["pricing"], []),
    el("plan.pro.price", "plan", "text", "$12 / month", true, ["pricing"], []),
    el("plan.compare.link", "plan", "link", "Compare plans", false, [], ["set_visibility", "set_label"]),
    el("invite.email", "invite", "textbox", "Teammate email", true, ["validation"], []),
    el("invite.submit", "invite", "button", "Send invite or skip", false, [], ["set_label", "set_style_token"]),
    el("done.heading", "done", "heading", "You're all set", false, [], ["set_label"]),
  ],
};
write("manifest.base.json", manifest);
const ptr = Object.fromEntries(manifest.elements.map((e, i) => [e.elementId, { x: 640 + ((i * 37) % 200) - 100, y: 180 + i * 38 }]));

// ---------- step templates ----------
// step: [type, elementId|null, screenBefore, screenAfter, result, valueKey?]
const S = {
  email: ["type", "signup.email", "signup", "signup", "ok", "email"],
  password: ["type", "signup.password", "signup", "signup", "ok", "password"],
  consent: ["click", "signup.consent", "signup", "signup", "ok"],
  signupSubmit: ["click", "signup.submit", "signup", "workspace", "ok"],
  signupSubmitNoEffect: ["click", "signup.submit", "signup", "signup", "no_effect"],
  wsName: ["type", "workspace.name", "workspace", "workspace", "ok", "workspaceName"],
  wsSubmit: ["click", "workspace.submit", "workspace", "plan", "ok"],
  compareOpen: ["click", "plan.compare.link", "plan", "compare", "ok"],
  compareClose: ["click", "plan.compare.link", "compare", "plan", "ok"],
  freeCta: ["click", "plan.free.cta", "plan", "invite", "ok"],
  inviteEmail: ["type", "invite.email", "invite", "invite", "ok", "inviteEmail"],
  inviteEmailBad: ["type", "invite.email", "invite", "invite", "validation_error", "inviteEmail"],
  inviteSubmit: ["click", "invite.submit", "invite", "done", "ok"],
  inviteSubmitNoEffect: ["click", "invite.submit", "invite", "invite", "no_effect"],
  stopPlan: ["stop", null, "plan", "plan", "ok"],
};
const head = [S.email, S.signupSubmit, S.wsName, S.wsSubmit]; // reach plan in 4
const T = {
  G6: { outcome: "goal", steps: [...head, S.freeCta, S.inviteSubmit] },
  G7: { outcome: "goal", steps: [...head, S.freeCta, S.inviteEmail, S.inviteSubmit] },
  G7b: { outcome: "goal", steps: [S.email, S.password, S.signupSubmit, S.wsName, S.wsSubmit, S.freeCta, S.inviteSubmit] },
  G8: { outcome: "goal", steps: [S.email, S.password, S.consent, S.signupSubmit, S.wsName, S.wsSubmit, S.freeCta, S.inviteSubmit] },
  G8R: { outcome: "goal", steps: [...head, S.compareOpen, S.compareClose, S.freeCta, S.inviteSubmit] },
  STOP_PLAN: { outcome: "agent_stop", steps: [S.email, S.password, S.signupSubmit, S.wsName, S.wsSubmit, S.stopPlan] },
  STOP_R: { outcome: "agent_stop", steps: [...head, S.compareOpen, S.compareClose, S.stopPlan] },
  STOP_R2: { outcome: "agent_stop", steps: [S.email, S.password, S.signupSubmit, S.wsName, S.wsSubmit, S.compareOpen, S.compareClose, S.stopPlan] },
  LIMIT_R: { outcome: "step_limit", steps: [...head, S.compareOpen, S.compareClose, S.compareOpen, S.compareClose] },
  BLOCK_VAL: { outcome: "flow_blocked", steps: [...head, S.freeCta, S.inviteEmailBad, S.inviteSubmitNoEffect] },
  BLOCK2: { outcome: "flow_blocked", steps: [S.email, S.signupSubmitNoEffect, S.password, S.signupSubmitNoEffect] },
  MODEL_ERR: { outcome: "model_error", steps: [S.email, S.password, S.signupSubmit] },
  BROWSER_ERR: { outcome: "browser_error", steps: [] },
  CANCELLED: { outcome: "user_cancelled", steps: [S.email, S.signupSubmit] },
};
const BEHAVIORAL = ["goal", "agent_stop", "step_limit", "flow_blocked"];
const reasons = {
  "plan.compare.link": "Want to understand the plan differences first.",
  stop: "Not sure which plan fits; stopping here.",
};

const iso = (ms) => new Date(ms).toISOString();
function makeRun({ runId, batchId, versionId, scenarioId, tpl, startMs }) {
  const t = T[tpl];
  const events = t.steps.map(([type, elementId, sb, sa, result, valueKey], seq) => {
    const action = { type };
    if (elementId) action.elementId = elementId;
    if (valueKey) action.value = scn[scenarioId].inputs[valueKey];
    if (type === "stop") action.reason = reasons.stop;
    else if (elementId === "plan.compare.link") action.reason = reasons["plan.compare.link"];
    const e = { runId, seq, at: iso(startMs + (seq + 1) * 4000), versionId, screenBefore: sb, screenAfter: sa, action, result };
    if (type === "click") e.pointer = ptr[elementId];
    e.viewport = { width: 1280, height: 800 };
    e.screenshot = { uri: `artifacts/${runId}/${seq}.png`, width: 1280, height: 800 };
    return e;
  });
  const pointers = events.filter((e) => e.pointer).map((e) => e.pointer);
  const run = {
    schemaVersion: SV, runId, experimentId: EXP, protocolId: PROTO, versionId, scenarioId, batchId, events,
    goalVerified: t.outcome === "goal",
  };
  if (t.outcome === "goal") run.goalEvidence = "checker: workspace exists on the free plan and the done screen was reached";
  run.stepCount = events.filter((e) => e.action.type !== "stop").length;
  run.outcome = t.outcome;
  run.terminalScreen = events.length ? events[events.length - 1].screenAfter : "signup";
  if (pointers.length) run.lastPointer = pointers[pointers.length - 1];
  run.screenshots = events.map((e) => e.screenshot);
  run.behaviorallyValid = BEHAVIORAL.includes(t.outcome);
  run.startedAt = iso(startMs);
  run.endedAt = iso(startMs + (events.length + 1) * 4000);
  return run;
}

const batches = {};
function makeBatch(file, { batchId, versionId, tag, startIso, plannedRuns = 12, assign }) {
  let ms = Date.parse(startIso);
  const runs = assign.map(([scenarioId, tpl], i) => {
    const r = makeRun({ runId: `run_${tag}_${String(i + 1).padStart(2, "0")}`, batchId, versionId, scenarioId, tpl, startMs: ms });
    ms += 45000;
    return r;
  });
  const calls = runs.reduce((n, r) => n + r.events.length, 0);
  const b = {
    schemaVersion: SV, batchId, versionId, runs,
    usage: { inferenceCalls: calls, inferenceUsd: Math.round(calls * 0.004 * 1000) / 1000, wallClockMs: runs.length * 45000 },
    cancelled: false, plannedRuns,
  };
  batches[file] = b;
  write(file, b);
  return b;
}

const metricsBatch = makeBatch("batch.metrics-4-4-2-1.json", {
  batchId: "batch_metrics01", versionId: VER_BASE, tag: "met", startIso: "2026-10-23T09:05:00.000Z",
  assign: [
    ["scn_baseline", "G6"], ["scn_baseline", "STOP_PLAN"], ["scn_baseline", "MODEL_ERR"],
    ["scn_invalid_email", "G8"], ["scn_invalid_email", "BLOCK_VAL"], ["scn_invalid_email", "BROWSER_ERR"],
    ["scn_hesitant", "G7"], ["scn_hesitant", "LIMIT_R"], ["scn_hesitant", "CANCELLED"],
    ["scn_fast", "G7b"], ["scn_fast", "STOP_R"],
  ],
});
const base = makeBatch("batch.baseline.json", {
  batchId: "batch_base0001", versionId: VER_BASE, tag: "base", startIso: "2026-10-23T09:15:00.000Z",
  assign: [
    ["scn_baseline", "G6"], ["scn_baseline", "G7"], ["scn_baseline", "STOP_PLAN"],
    ["scn_invalid_email", "G8"], ["scn_invalid_email", "BLOCK_VAL"], ["scn_invalid_email", "BLOCK2"],
    ["scn_hesitant", "G8R"], ["scn_hesitant", "STOP_R"], ["scn_hesitant", "LIMIT_R"],
    ["scn_fast", "G7b"], ["scn_fast", "G8R"], ["scn_fast", "STOP_R2"],
  ],
});
const improved = makeBatch("batch.candidate-improved.json", {
  batchId: "batch_cand0001", versionId: VER_CAND1, tag: "imp", startIso: "2026-10-23T10:00:00.000Z",
  assign: [
    ["scn_baseline", "G6"], ["scn_baseline", "G6"], ["scn_baseline", "G7"],
    ["scn_invalid_email", "G8"], ["scn_invalid_email", "BLOCK_VAL"], ["scn_invalid_email", "G6"],
    ["scn_hesitant", "G8R"], ["scn_hesitant", "LIMIT_R"], ["scn_hesitant", "G7b"],
    ["scn_fast", "G7"], ["scn_fast", "G8"], ["scn_fast", "STOP_PLAN"],
  ],
});
const flat = makeBatch("batch.candidate-flat.json", {
  batchId: "batch_cand0002", versionId: VER_CAND2, tag: "flat", startIso: "2026-10-23T10:30:00.000Z",
  assign: [
    ["scn_baseline", "G6"], ["scn_baseline", "G7"], ["scn_baseline", "STOP_PLAN"],
    ["scn_invalid_email", "G8"], ["scn_invalid_email", "BLOCK_VAL"], ["scn_invalid_email", "BLOCK2"],
    ["scn_hesitant", "G8R"], ["scn_hesitant", "LIMIT_R"], ["scn_hesitant", "STOP_R"],
    ["scn_fast", "G6"], ["scn_fast", "G7b"], ["scn_fast", "G8"],
  ],
});
makeBatch("batch.zero-valid.json", {
  batchId: "batch_zero0001", versionId: VER_BASE, tag: "zero", startIso: "2026-10-23T11:00:00.000Z",
  assign: scenarios.flatMap((s, i) => [0, 1, 2].map((j) => [s.id, (i * 3 + j) % 2 === 0 ? "MODEL_ERR" : "BROWSER_ERR"])),
});
makeBatch("batch.underfilled.json", {
  batchId: "batch_under001", versionId: VER_BASE, tag: "under", startIso: "2026-10-23T11:30:00.000Z",
  assign: [
    ["scn_baseline", "G6"], ["scn_baseline", "STOP_PLAN"],
    ["scn_invalid_email", "G8"], ["scn_invalid_email", "BLOCK_VAL"],
    ["scn_hesitant", "G8R"], ["scn_hesitant", "LIMIT_R"],
    ["scn_fast", "MODEL_ERR"], ["scn_fast", "BROWSER_ERR"],
  ],
});

// single-run fixtures, taken from the metrics batch
const byOutcome = (o) => metricsBatch.runs.find((r) => r.outcome === o);
for (const [file, o] of [["goal", "goal"], ["agent-stop", "agent_stop"], ["step-limit", "step_limit"], ["flow-blocked", "flow_blocked"],
  ["model-error", "model_error"], ["browser-error", "browser_error"], ["cancelled", "user_cancelled"]]) {
  write(`runs/${file}.json`, byOutcome(o));
}

// ---------- metrics (spec §5.2) ----------
const OUTCOMES = ["goal", "agent_stop", "step_limit", "flow_blocked", "model_error", "browser_error", "user_cancelled"];
const med = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const counts = (runs) => Object.fromEntries(OUTCOMES.map((o) => [o, runs.filter((r) => r.outcome === o).length]));
const backtracks = (r) => { const left = new Set(); for (const e of r.events) { if (left.has(e.screenBefore)) return true; if (e.screenBefore !== e.screenAfter) left.add(e.screenBefore); } return false; };
const hasVE = (r) => r.events.some((e) => e.result === "validation_error");
function metrics(b) {
  const pol = protocol.policy;
  const valid = b.runs.filter((r) => r.behaviorallyValid);
  const goals = valid.filter((r) => r.outcome === "goal");
  const perScenario = scenarios.map((s) => {
    const rs = b.runs.filter((r) => r.scenarioId === s.id);
    const v = rs.filter((r) => r.behaviorallyValid);
    const g = v.filter((r) => r.outcome === "goal");
    return { scenarioId: s.id, plannedRuns: s.runs, validRuns: v.length, successes: g.length, completionRate: v.length ? g.length / v.length : null,
      outcomeCounts: counts(rs), medianActionsToSuccess: med(g.map((r) => r.stepCount)), complete: v.length >= pol.minValidPerScenario };
  });
  const enough = valid.length >= Math.ceil(pol.minValidFraction * b.plannedRuns);
  const complete = enough && perScenario.every((s) => s.complete);
  const m = {
    versionId: b.versionId, batchId: b.batchId, plannedRuns: b.plannedRuns, validRuns: valid.length, successes: goals.length,
    completionRate: valid.length ? goals.length / valid.length : null, outcomeCounts: counts(b.runs),
    infraErrors: b.runs.filter((r) => r.outcome === "model_error" || r.outcome === "browser_error").length,
    cancelled: b.runs.filter((r) => r.outcome === "user_cancelled").length,
    medianActionsToSuccess: med(goals.map((r) => r.stepCount)),
    backtrackRuns: valid.filter(backtracks).length, validationErrorRuns: valid.filter(hasVE).length,
    perScenario, complete,
  };
  if (!complete) m.incompleteReason = enough ? "a scenario has fewer valid runs than minValidPerScenario" : `validRuns ${valid.length} < ceil(${pol.minValidFraction} x ${b.plannedRuns})`;
  return m;
}
const mBase = metrics(base), mImp = metrics(improved), mFlat = metrics(flat);

// ---------- observations (from baseline) ----------
const valid = base.runs.filter((r) => r.behaviorallyValid);
const revisitPlan = valid.filter((r) => { let left = false; for (const e of r.events) { if (left && e.screenBefore === "plan") return true; if (e.screenBefore === "plan" && e.screenAfter !== "plan") left = true; } return false; });
const veRuns = valid.filter(hasVE);
const stepLimit = valid.filter((r) => r.outcome === "step_limit");
const stopPlan = valid.filter((r) => r.outcome === "agent_stop" && r.terminalScreen === "plan");
const repeatedFail = valid.filter((r) => r.events.filter((e) => e.action.elementId === "signup.submit" && e.result === "no_effect").length >= 2);
const obsBase = { schemaVersion: SV, experimentId: EXP, versionId: VER_BASE, batchId: base.batchId, disposition: "unreviewed" };
const firstSeq = (r, pred) => r.events.find(pred)?.seq;
const observations = [
  { ...obsBase, id: "obs_0001", kind: "outcome_count", statement: `${mBase.successes} of ${mBase.validRuns} valid runs reached the goal`,
    numerator: mBase.successes, denominator: mBase.validRuns, traceRefs: valid.filter((r) => r.outcome === "goal").map((r) => ({ runId: r.runId })),
    screens: ["done"], elementIds: [], fingerprint: "outcome_count:goal" },
  { ...obsBase, id: "obs_0002", kind: "screen_revisit", statement: `${revisitPlan.length} of ${valid.length} runs revisited plan selection`,
    numerator: revisitPlan.length, denominator: valid.length,
    traceRefs: revisitPlan.map((r) => ({ runId: r.runId, seq: firstSeq(r, (e) => e.screenBefore === "compare") })),
    screens: ["plan"], elementIds: ["plan.compare.link"], fingerprint: "screen_revisit:plan" },
  { ...obsBase, id: "obs_0003", kind: "outcome_count", statement: `${stopPlan.length} of ${valid.length} runs stopped on plan selection without choosing a plan`,
    numerator: stopPlan.length, denominator: valid.length, traceRefs: stopPlan.map((r) => ({ runId: r.runId, seq: r.events.length - 1 })),
    screens: ["plan"], elementIds: ["plan.free.cta", "plan.pro.cta"], fingerprint: "outcome_count:agent_stop:plan" },
  { ...obsBase, id: "obs_0004", kind: "validation_error", statement: `${veRuns.length} of ${valid.length} runs hit a validation error on invite.email`,
    numerator: veRuns.length, denominator: valid.length,
    traceRefs: veRuns.map((r) => ({ runId: r.runId, seq: firstSeq(r, (e) => e.result === "validation_error") })),
    screens: ["invite"], elementIds: ["invite.email"], fingerprint: "validation_error:invite.email" },
  { ...obsBase, id: "obs_0005", kind: "step_limit", statement: `${stepLimit.length} of ${valid.length} runs used all ${protocol.budgets.maxActionsPerRun} actions without finishing`,
    numerator: stepLimit.length, denominator: valid.length, traceRefs: stepLimit.map((r) => ({ runId: r.runId })),
    screens: ["plan"], elementIds: ["plan.compare.link"], fingerprint: "step_limit" },
  { ...obsBase, id: "obs_0006", kind: "repeated_failed_action", statement: `${repeatedFail.length} of ${valid.length} runs repeated a no-effect click on signup.submit`,
    numerator: repeatedFail.length, denominator: valid.length,
    traceRefs: repeatedFail.map((r) => ({ runId: r.runId, seq: firstSeq(r, (e) => e.result === "no_effect") })),
    screens: ["signup"], elementIds: ["signup.submit"], interpretation: "Signup is protected; the designer may mark this intentional.",
    fingerprint: "repeated_failed_action:signup.submit" },
];
write("observations.json", { items: observations });

// ---------- feedback packet / approval ----------
const patchBase = { schemaVersion: SV, experimentId: EXP, round: 1, sourceVersionId: VER_BASE };
const patches = [
  { ...patchBase, id: "pat_0001", op: "set_label", value: "Start free", targetElementId: "plan.free.cta", observationIds: ["obs_0002", "obs_0003"],
    rationale: "Runs paused on plan selection; a label that states the outcome may reduce hesitation.", modelRisk: "low", risk: "review_required", state: "proposed" },
  { ...patchBase, id: "pat_0002", op: "set_style_token", value: "button.primary", targetElementId: "plan.free.cta", observationIds: ["obs_0003"],
    rationale: "Give the free plan call to action primary emphasis so the default choice is visible.", risk: "low", state: "proposed" },
  { ...patchBase, id: "pat_0003", op: "set_visibility", value: false, targetElementId: "plan.compare.link", observationIds: ["obs_0002", "obs_0005"],
    rationale: "Every plan revisit went through the comparison view; hiding it may remove the loop.", modelRisk: "review_required", risk: "review_required", state: "proposed" },
  { ...patchBase, id: "pat_0004", op: "set_label", value: "Free forever", targetElementId: "plan.pro.price", observationIds: ["obs_0003"],
    rationale: "Clarify pricing on the plan screen.", modelRisk: "low", risk: "blocked", state: "blocked",
    blockReason: "plan.pro.price is protected (category pricing)" },
];
write("feedback-packet.json", {
  schemaVersion: SV, id: "pkt_r1_0001", experimentId: EXP, versionId: VER_BASE, task: protocol.task, intentConstraints: protocol.intentConstraints,
  observations: observations.map((o) => ({ id: o.id, statement: o.statement })),
  traceEvidence: observations.find((o) => o.id === "obs_0002").traceRefs,
  hypotheses: [
    { schemaVersion: SV, id: "hyp_0001", experimentId: EXP, round: 1, observationIds: ["obs_0002", "obs_0003"], label: "hypothesis", confidence: "medium",
      statement: "Agents are unsure which plan to pick and use the comparison view to decide, then stall." },
  ],
  patches,
  protectedConstraints: ["Prices (plan.free.price, plan.pro.price) are protected.", "Signup, consent, auth and validation elements are protected."],
  reviewPolicy: "manual_required",
  createdAt: "2026-10-23T09:30:00.000Z",
});
write("approval.partial.json", {
  schemaVersion: SV, id: "appr_0001", experimentId: EXP, round: 1, sourceVersionId: VER_BASE, patchIds: ["pat_0001", "pat_0002"],
  approvedBy: "designer@example.com", at: "2026-10-23T09:40:00.000Z",
});

// ---------- candidates / validation ----------
write("candidate.json", {
  schemaVersion: SV, id: "cand_0001", versionId: VER_CAND1, parentVersionId: VER_BASE, patchIds: ["pat_0001", "pat_0002"],
  url: `http://localhost:4100/v/${VER_CAND1}`,
  figma: { frameUrl: "https://www.figma.com/design/FIXTURE/ghostloop?node-id=1-2", status: "verified", manifestHash: "sha256:fixture-cand-0001", patchIds: ["pat_0001", "pat_0002"] },
  reviewStatus: "pending", evaluationId: "eval_0001", createdAt: "2026-10-23T09:45:00.000Z",
});
write("candidate.figma-mismatch.json", {
  schemaVersion: SV, id: "cand_0002", versionId: VER_CAND2, parentVersionId: VER_BASE, patchIds: ["pat_0001"],
  url: `http://localhost:4100/v/${VER_CAND2}`,
  figma: { frameUrl: "https://www.figma.com/design/FIXTURE/ghostloop?node-id=1-3", status: "mismatch", manifestHash: "sha256:fixture-cand-0002-figma", patchIds: ["pat_0001"] },
  reviewStatus: "pending", evaluationId: "eval_0003", createdAt: "2026-10-23T10:20:00.000Z",
});
const passChecks = [
  { name: "build", kind: "runnable", passed: true },
  { name: "renders_all_screens", kind: "runnable", passed: true },
  { name: "protected_elements_unchanged", kind: "guardrail", passed: true },
  { name: "manifest_ids_stable", kind: "guardrail", passed: true },
  { name: "checker_unchanged", kind: "guardrail", passed: true },
];
write("validation.pass.json", { schemaVersion: SV, id: "val_0001", candidateId: "cand_0001", ok: true, checks: passChecks, at: "2026-10-23T09:50:00.000Z" });
const failChecks = passChecks.map((c) => c.name === "protected_elements_unchanged"
  ? { ...c, passed: false, detail: "plan.pro.price label changed from \"$12 / month\" to \"Free forever\"" } : c);
write("validation.fail.json", { schemaVersion: SV, id: "val_0002", candidateId: "cand_0003", ok: false, checks: failChecks, at: "2026-10-23T11:50:00.000Z" });

// ---------- evaluations ----------
const guard = (checks) => checks.filter((c) => c.kind === "guardrail").map(({ name, passed, detail }) => (detail ? { name, passed, detail } : { name, passed }));
const evBase = { schemaVersion: SV, experimentId: EXP, protocolId: PROTO, baselineVersionId: VER_BASE };
// compare() rounds deltaPp to 1 decimal
const round1 = (x) => Math.round(x * 10) / 10;
const dAcc = round1((mImp.completionRate - mBase.completionRate) * 100);
const dFlat = round1((mFlat.completionRate - mBase.completionRate) * 100);

write("evaluation.accepted.json", {
  ...evBase, id: "eval_0001", candidateVersionId: VER_CAND1, baseline: mBase, candidate: mImp, guardrails: guard(passChecks), deltaPp: dAcc,
  decision: "accepted",
  reasons: [
    `completion rate ${mBase.completionRate} -> ${mImp.completionRate} (+${dAcc.toFixed(1)}pp) meets minImprovementPp 10`,
    `median actions to success ${mBase.medianActionsToSuccess} -> ${mImp.medianActionsToSuccess} (within +2)`,
    `validation-error runs ${mBase.validationErrorRuns}/${mBase.validRuns} -> ${mImp.validationErrorRuns}/${mImp.validRuns} (within +15pp)`,
    "candidate rate 0.75 is below target 0.8 with rounds remaining; round complete, no stopping record yet",
  ],
  at: "2026-10-23T10:25:00.000Z",
});
write("evaluation.rejected.json", {
  ...evBase, id: "eval_0002", candidateVersionId: VER_CAND3, baseline: mBase, candidate: null, guardrails: guard(failChecks), deltaPp: null,
  decision: "rejected", reasons: ["guardrail protected_elements_unchanged failed; candidate batch not run"],
  stoppingReason: "NO_MEASURED_IMPROVEMENT", at: "2026-10-23T11:55:00.000Z",
});
write("evaluation.inconclusive.json", {
  ...evBase, id: "eval_0003", candidateVersionId: VER_CAND2, baseline: mBase, candidate: mFlat, guardrails: guard(passChecks), deltaPp: dFlat,
  decision: "inconclusive",
  reasons: [`completion rate ${mBase.completionRate} -> ${mFlat.completionRate.toFixed(3)} (+${dFlat.toFixed(1)}pp) is below minImprovementPp 10`],
  stoppingReason: "INCONCLUSIVE", at: "2026-10-23T10:55:00.000Z",
});
console.log(`fixtures written to ${OUT}`);
