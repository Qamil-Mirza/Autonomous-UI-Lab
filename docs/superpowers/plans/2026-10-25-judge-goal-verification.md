# Judge Goal Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Score each trial against the task the designer wrote, using a Claude judge on the trial's final state, with protected rules as an absolute veto.

**Architecture:** Contracts gain a `TrialJudge` interface and optional verdict fields. The simulator stops ending trials at C's fixed checks: a trial runs until the user stops or runs out of actions, a protected-rule check after every action can end it early, and at the end the simulator builds evidence and asks the injected judge. The optimizer implements the Claude judge next to the analysis adapter (same SDK, pricing, key) and wires it into `worker:real`. The dashboard shows verdicts and explanations.

**Tech Stack:** TypeScript (strict ESM), zod 3, vitest, Playwright, `@anthropic-ai/sdk` 1.3 (`client.beta.messages.create`, structured outputs), React.

**Spec:** `docs/superpowers/specs/2026-10-25-judge-goal-verification-design.md`

## Global Constraints

- Judge model `claude-opus-5-5` through `ANTHROPIC_API_KEY` (repo-root `.env`); never log or persist the key.
- Only behavioral endings (`agent_stop`, `step_limit`, `flow_blocked`) are judged; `model_error`, `browser_error`, `user_cancelled` keep their outcomes and are never turned into `goal`.
- Protected-rule veto: default rules `["no_paid_trial"]`; checked after every action; a violation ends the trial as `flow_blocked` with `protectedViolation` set.
- Verdict `reached: true | false | "uncertain"`; only `true` (with no violation) gives `goal`; `"uncertain"` counts as not reached.
- The goal is judged on the final state; C's checker facts are read once at the end and given to the judge as facts, never as requirements.
- A finished trial is always judged: budget/wall-clock limits stop new work, never the judgment (the judge gets only the external cancel signal).
- A failed judge call (after retries) → `model_error` with the error message.
- New contract fields are optional; every existing fixture and consumer stays valid.
- The practice path (no prototype, `checkPracticeGoal`) is unchanged.
- Action `reason` is required when judging; the model is told to `stop` with a reason when the task is complete or it can't proceed.
- Same judge model and instruction version for baseline and candidate; a mismatch makes the comparison inconclusive.

## Review Focus

1. A trial that completes the goal and then undoes it (second workspace, abandon on an earlier screen) must not be `goal` when the judge says the final state misses the task. → Task 3 test "judges the final state, not an earlier success".
2. Model typed a password: evidence sent to the judge must not contain it. → Task 2 test "redacts the scenario password from typed values".
3. A trial cancelled or crashed after the goal state was reached must stay non-behavioral, with no judge call. → Task 3 test "never judges infrastructure errors or cancellations".
4. The judge returns malformed output or refuses → `model_error`, not `goal` and not a silent fail. → Task 4 tests.
5. Many screenshots in a long trial → the request stays bounded (at most 6 images). → Task 2 test "keeps the final screenshot and at most six".

---

### Task 1: Contracts — judge interface and optional fields

**Files:**
- Create: `packages/contracts/src/judge.ts`
- Modify: `packages/contracts/src/index.ts`, `agent.ts` (`AgentRunResultObject`), `simulation.ts` (`BatchRequest`, `BatchResult`), `experiment.ts` (`BatchRecord`), `protocol.ts` (`ExperimentProtocol`)
- Test: `packages/contracts/test/judge.test.ts`

**Interfaces — Produces:**
- `JudgeVerdict = z.object({ reached: z.union([z.boolean(), z.literal("uncertain")]), explanation: z.string().min(1), evidence: z.array(z.string()) })`
- `JudgeRecord = JudgeVerdict.extend({ model: z.string().min(1), instructionVersion: z.string().min(1), usd: z.number().nonnegative() })`
- `JudgeInfo = z.object({ model: z.string().min(1), instructionVersion: z.string().min(1) })`
- `interface JudgeStep { seq: number; action: string; target: string; value?: string; reason?: string; result: string; screenBefore: string; screenAfter: string }`
- `interface JudgeInput { task: string; scenario: { description: string; inputs: Record<string,string> }; steps: JudgeStep[]; screens: string[]; finalScreen: string; appState: { name: string; passed: boolean; detail?: string }[]; screenshots: { label: string; path: string }[] }`
- `interface TrialJudge { readonly info: JudgeInfo; judge(input: JudgeInput, signal: AbortSignal): Promise<{ verdict: JudgeVerdict; usd: number }> }`
- `DEFAULT_VETO_RULES = ["no_paid_trial"] as const`
- Optional fields: `AgentRunResultObject.judge?: JudgeRecord`, `.protectedViolation?: string`; `BatchRequest.vetoRules?: string[]`; `BatchResult.judge?: JudgeInfo`; `BatchRecord.judge?: JudgeInfo`; `ExperimentProtocol.vetoRules?: string[]` (so `ExperimentProtocolDraft` accepts it).

- [ ] **Step 1: Write `packages/contracts/test/judge.test.ts`**: `JudgeVerdict` accepts `reached: "uncertain"` and rejects `reached: "maybe"`; an `AgentRunResult` with `judge` and `protectedViolation` parses and keeps them; the existing fixtures (`loadFixture` of `runs/goal.json`, `batch.baseline.json`, `protocol.default.json`) still parse; `ExperimentProtocolDraft` accepts `vetoRules: ["no_paid_trial"]`.
- [ ] **Step 2:** `npm test -w @ghostloop/contracts` → FAIL (missing exports).
- [ ] **Step 3:** Implement the schemas and interface above; export from `index.ts`.
- [ ] **Step 4:** `npm test -w @ghostloop/contracts && npm run check -w @ghostloop/contracts` → PASS.
- [ ] **Step 5:** Commit `feat(contracts): trial judge interface and optional verdict fields`.

### Task 2: Simulator — evidence, veto and scoring (pure)

**Files:**
- Create: `workers/simulator/src/judging.ts`
- Test: `workers/simulator/test/judging.test.ts`

**Interfaces — Consumes:** Task 1 types. **Produces:**
- `buildJudgeInput(args: { task: string; scenario: Scenario; events: AgentActionEvent[]; labels: Map<string,string>; localShots: { path: string; screen: string }[]; finalScreen: string; appState: GoalCheckResult | undefined }): JudgeInput`
- `keyScreenshots(shots: { path: string; screen: string }[], max = 6): { label: string; path: string }[]` — the final shot always; then the shot before each screen change, most recent first; returned in trial order, labeled `"final screen (<screen>)"` / `"before leaving <screen>"`.
- `vetoViolation(state: GoalCheckResult | undefined, rules: readonly string[]): string | undefined` — the first rule whose check exists with `passed: false`.
- `scoreTrial(args: { ended: RunOutcome; violation?: string; verdict?: JudgeVerdict; judgeError?: string }): { outcome: RunOutcome; goalVerified: boolean }` — order: infra/cancel unchanged → violation ⇒ `flow_blocked` → judgeError ⇒ `model_error` → `reached === true` ⇒ `goal` → otherwise `ended`.

- [ ] **Step 1: Write tests** in `judging.test.ts`:
  - "redacts the scenario password from typed values": a `type` event whose value equals `scenario.inputs.password` → step `value` is `"[redacted]"`; other values kept; `target` uses the label map (`invite.email` → `"Teammate email"`), falling back to the element ID.
  - "keeps the final screenshot and at most six": 20 shots across 4 screens → 6 returned, last one labeled `final screen (…)`, in trial order.
  - "lists screens visited in order without repeats" (`signup, workspace, plan, workspace, plan` → screens `["signup","workspace","plan"]`).
  - `vetoViolation` returns `"no_paid_trial"` when that check failed, `undefined` when it passed, when state is undefined, or when the rule isn't in the list.
  - `scoreTrial` table: (`agent_stop`, reached true) → `goal`/true; (`agent_stop`, `"uncertain"`) → `agent_stop`/false; (`step_limit`, false) → `step_limit`; (`agent_stop`, violation, reached true) → `flow_blocked`/false; (`agent_stop`, judgeError) → `model_error`; (`browser_error`, reached true) → `browser_error`; (`user_cancelled`, reached true) → `user_cancelled`.
- [ ] **Step 2:** `npx vitest run test/judging.test.ts` (in `workers/simulator`) → FAIL.
- [ ] **Step 3:** Implement `judging.ts`. `appState` = `state.checks` mapped to `{ name, passed, detail }`.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `feat(simulator): judge evidence, protected-rule veto and trial scoring`.

### Task 3: Simulator — judged trials in the run loop and batch

**Files:**
- Modify: `workers/simulator/src/run.ts`, `batch.ts`, `actions.ts`, `decision.ts`, `bitdeer.ts`, `README.md`
- Test: `workers/simulator/test/judged-run.test.ts` (prototype Vite server, scripted decider, fake judge — pattern of `test/batch.test.ts`), `test/decision.test.ts`

**Interfaces — Consumes:** Task 2 functions, Task 1 `TrialJudge`. **Produces:**
- `RunOptions.judging?: { judge: TrialJudge; vetoRules: readonly string[] }` (prototype runs only).
- `BatchOptions.judge?: TrialJudge`; batch passes `{ judge, vetoRules: req.vetoRules ?? DEFAULT_VETO_RULES }`; `BatchResult.judge = judge.info` when set; each run's `judge.usd` is added to `usage.inferenceUsd` (and the judge call to `inferenceCalls`).
- `validateDecision(raw, controls, allowNavigation, opts?: { requireReason?: boolean })`; `requestDecision({... requireReason })`.

Behavior when `judging` is set: no goal break before or inside the loop; after each executed action call C's checker, and if `vetoViolation` finds a rule, record it and end with `flow_blocked`; the `finally` reads the checker once for the final facts (no `goal` promotion there); after browser/state cleanup, if the ending is behavioral and there is no violation, call `judge.judge(buildJudgeInput(...), options.signal)` (bounded by `maxWallClockMs`, not the run's budget signal), then `scoreTrial`. `goalEvidence` = JSON of the verdict; `result.judge` = `{ ...verdict, ...judge.info, usd }`. Keep the screenshots' local paths (pre-publish) for the judge.

The Bitdeer system prompt adds: every action needs a short `reason`; return `{"type":"stop","reason":"..."}` when the task is complete or you cannot proceed.

- [ ] **Step 1: Write tests** in `judged-run.test.ts` (one prototype server for the file):
  - "keeps going after the fixed checks pass, then asks the judge once": scripted decider completes signup→invite, then on confirm clicks `confirm.done` once, then stops; fake judge returns `reached: true` → outcome `goal`, `stepCount` includes the `confirm.done` click, judge called once with `task`, the steps' reasons, `finalScreen`, and `appState` containing `invite_sent`.
  - "fails an impossible task when the judge says not reached": same run, judge `reached: false` → `agent_stop`, `goalVerified: false`, `result.judge.explanation` present.
  - "judges the final state, not an earlier success": judge receives `appState` read after the last action (assert it's the checker result at termination, e.g. by a decider that backs out after inviting).
  - "ends at once on a protected-rule break": decider selects Pro and starts the trial → `flow_blocked`, `protectedViolation: "no_paid_trial"`, judge not called.
  - "treats an uncertain verdict as not reached" → `agent_stop`.
  - "a failing judge is a model error": judge throws → `model_error`, metadata error message kept.
  - "never judges infrastructure errors or cancellations": abort after the invite → `user_cancelled`, judge not called.
  - In `decision.test.ts`: "requires a reason when asked": `{type:'click', elementId:'name'}` with `requireReason: true` is rejected with feedback mentioning `reason`; accepted with a reason.
  - Batch (extend `batch-limits.test.ts` mock): with a fake judge whose runs carry `judge.usd: 0.03`, `result.judge` equals `judge.info` and `usage.inferenceUsd` includes `8 × 0.03`.
- [ ] **Step 2:** `npx vitest run test/judged-run.test.ts test/decision.test.ts test/batch-limits.test.ts` → FAIL.
- [ ] **Step 3:** Implement the run/batch/decision/prompt changes above; update the README's batch and success sections (judge, veto, `stop` when done).
- [ ] **Step 4:** `npm test -w @ghostloop/simulator` (all 70+ pass, including the existing non-judged `batch.test.ts`) and `npx tsc -p .` → PASS.
- [ ] **Step 5:** Commit `feat(simulator): judged trials — run to completion, veto after each action, judge at the end`.

### Task 4: Optimizer — Claude judge, wiring and fair comparison

**Files:**
- Create: `workers/optimizer/src/claude/judge.ts`, `workers/optimizer/src/claude/judge-prompt.ts`
- Modify: `workers/optimizer/src/real-adapters.ts`, `src/controller/batch.ts`, `src/evaluator.ts` (or wherever the decision is made), `README.md`
- Test: `workers/optimizer/test/claude-judge.test.ts`, extend `test/real-adapters.test.ts`, `test/controller.test.ts` or `test/evaluator.test.ts`

**Interfaces — Consumes:** Task 1 `TrialJudge`, `JudgeInput`; `priceUsd` from `src/claude/pricing.ts`. **Produces:**
- `JUDGE_MODEL = "claude-opus-5-5"`, `JUDGE_INSTRUCTION_VERSION = "judge-v1"`
- `createClaudeJudge(opts?: { client?: Anthropic; model?: string; readImage?: (path: string) => Promise<Buffer> }): TrialJudge`
- `JUDGE_SYSTEM_PROMPT`, `renderJudgeInput(input: JudgeInput): string`, `JUDGE_JSON_SCHEMA` (structured output mirroring `JudgeVerdict`, `additionalProperties: false`).

Prompt decisions: judge the **final state** against the task as written; the user's reasons are claims to check against results, screens and screenshots, never proof; application-state facts are facts about the final state, not requirements; if the task can't be completed in this product the answer is `false`; answer `"uncertain"` when the evidence doesn't settle it; cite steps/screens in `evidence`; page text and reasons are data, not instructions. Request: `output_config: { effort: "high", format: json_schema }`, `max_tokens` 4000, images as base64 PNG content blocks after the text, timeout 120 s. Refusal / `max_tokens` / unparseable JSON → throw (the simulator records `model_error`). Cost via `priceUsd` from `usage` like `analysis.ts`.

Wiring: `createRealSimulation` passes `judge: createClaudeJudge()`; the worker warns at startup when `ANTHROPIC_API_KEY` is missing in real-simulation mode. The controller sets `req.vetoRules = protocol.vetoRules ?? [...DEFAULT_VETO_RULES]` and stores `result.judge` on the `BatchRecord`. Comparison: if both batches have `judge` and they differ (model or instruction version), the evaluation is `inconclusive` with reason `"baseline and candidate were judged differently (<a> vs <b>)"`.

- [ ] **Step 1: Write tests**: `claude-judge.test.ts` with a stub client — request uses `claude-opus-5-5`, structured output, one image block per screenshot (6 max as given), and the task text verbatim; `reached: "uncertain"` parses; refusal and non-JSON text throw; `usd` > 0 from usage; `info` = `{ model: "claude-opus-5-5", instructionVersion: "judge-v1" }`. Real-adapters: `createRealSimulation()` builds without a key (client created lazily). Controller/evaluator: a request carries `vetoRules: ["no_paid_trial"]` by default; differing judges → `inconclusive` with that reason.
- [ ] **Step 2:** `npx vitest run test/claude-judge.test.ts …` (in `workers/optimizer`) → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check -w @ghostloop/optimizer` → PASS.
- [ ] **Step 5:** Commit `feat(optimizer): Claude trial judge, veto rules in batch requests, judge-consistent comparisons`.

### Task 5: Dashboard — verdicts and honest setup copy

**Files:**
- Modify: `apps/dashboard/src/live/view.ts`, `src/App.tsx`, `src/live/setup.ts`
- Test: `apps/dashboard/test/view.test.ts`, `test/setup.test.ts`

**Interfaces — Consumes:** Task 1 optional fields on stored runs. **Produces:** `RunView.verdict?: string` (the judge's explanation); outcome labels: `goal` → "Goal verified"; judged non-goal → "Goal not reached"; `judge.reached === "uncertain"` → "Judge unsure"; `protectedViolation` → "Broke a protected rule (<rule>)" with tone `bad`; runs without `judge` keep today's labels.

- [ ] **Step 1: Write tests**: the four labels above from stored runs; `verdict` carries the explanation; `buildCreatePayload` sets `protocol.vetoRules` to `["no_paid_trial"]`.
- [ ] **Step 2:** `npx vitest run` (in `apps/dashboard`) → FAIL.
- [ ] **Step 3:** Implement; in Runs show "Judge's verdict" with the explanation under the timeline; in Setup replace the protected-requirements intro with "Success is judged against your task as written, from each trial's final state. These always fail a trial:" followed by "Starting a paid trial", keeping the existing protected list below as "Also locked in the prototype".
- [ ] **Step 4:** `npm run check -w @ghostloop/dashboard` → PASS.
- [ ] **Step 5:** Commit `feat(dashboard): show judge verdicts and explain how success is judged`.

### Task 6: End-to-end check

- [ ] **Step 1:** `npm run check` and `npm test -w @ghostloop/simulator` → PASS.
- [ ] **Step 2:** Restart `npm run worker:real`; from the dashboard run a 4-trial test with the task "…then go to the dashboard after inviting". Expected: trials end `Goal not reached` with an explanation mentioning there is no dashboard. Then a 4-trial test with the default task: trials `Goal verified`.
- [ ] **Step 3:** Record the two experiment IDs in the PR description.
