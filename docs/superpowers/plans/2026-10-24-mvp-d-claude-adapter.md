# MVP D Claude Analysis Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mock `AnalysisAdapter` with a real Claude call that turns the task, constraints, observations and editable elements into a `RawFeedbackProposal`, selectable with `--analysis claude` while mocks stay the default.

**Architecture:** One structured-output Messages API call per proposing step, made from the optimizer worker with the official `@anthropic-ai/sdk`. The adapter only produces untrusted `raw` output plus usage; `validatePacket` in `workers/optimizer/src/policy.ts` stays the gate (IDs, risk, protected elements, retry once then `NO_VALID_PATCH`). The controller, policy and contracts do not change.

**Tech Stack:** TypeScript strict ESM, `@anthropic-ai/sdk` (latest, 1.3.x at time of writing), zod 3, vitest, tsx, npm workspaces, Node 22.

**Spec:** none — the user skipped the design questions; the decisions below are the controller's calls and are listed under "Calls" at the end. Issue #4: "Generate neutral observations before hypotheses … call Claude with the task, intent, constraints, observations, and evidence. Validate its structured feedback packet …"

**Base:** branch `feature/MVP-D-Claude-Adapter`, stacked on `feature/MVP-D-SpacetimeDB` (PR #7), because the worker CLI and `createMockAdapters` it wires into live there.

## Global Constraints

- Model ID exactly `claude-opus-5-5` (no date suffix). Effort `"high"` via `output_config.effort`. Omit `thinking` (adaptive is the default and the only mode on this model). Never send `temperature`/`top_p`/`top_k`, `budget_tokens`, assistant prefill, or forced `tool_choice`.
- Structured output via `output_config.format` = `{ type: "json_schema", schema: PROPOSAL_JSON_SCHEMA }` (static schema; every object `additionalProperties: false`; no `minLength`/`minimum` constraints).
- Refusal fallback on by default: `betas: ["server-side-fallback-2026-07-01"]` + `fallbacks: "default"` (so the call goes through `client.beta.messages.create`). Verify the parameter names against the installed SDK's types before writing; if the SDK types lack `fallbacks`, follow the SDK's documented way to send an extra body field — never guess an API.
- Check `stop_reason` before reading content: `"refusal"` and `"max_tokens"` are thrown as errors (they become `INTEGRATION_FAILURE` through the controller's `adapter()` wrapper).
- `max_tokens: 16000`, non-streaming, per-request timeout 180000 ms; SDK default retries (2) for 429/5xx/connection errors; no extra retry layer.
- Credentials come only from the environment (`new Anthropic()` default resolution: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, or an `ant auth login` profile). Never log, persist or echo a key. The key stays in the worker.
- `@anthropic-ai/sdk` is the only new dependency, in `workers/optimizer` only.
- Root `npm run check` passes with no API key and no network; the real API is called only by a test gated on `ANTHROPIC_LIVE_TEST=1`.
- Mocks stay the default everywhere (`--analysis mock`); existing demo and worker behavior and output with mocks are unchanged.
- Fictional data only. Commit messages carry no attribution lines. Never commit `docs/MERGE-PLAN.md` or `docs/FIGMA-SPONSOR-BRIEF.md`.

## Review Focus

1. No credentials set and `--analysis claude`: the CLI prints a warning naming `ANTHROPIC_API_KEY` at startup, and the round stops with `INTEGRATION_FAILURE` whose reason contains the SDK's error text — never a hang or a crash with a stack trace (Task 2 test with a client stub that throws `Anthropic.AuthenticationError`).
2. Claude cites an observation or element that isn't in the input: the adapter passes it through untouched and `validatePacket` rejects it, so the round retries once and then stops `NO_VALID_PATCH` (Task 1 test through `validatePacket`).
3. Claude's text isn't JSON (or is empty): `raw` becomes `{ unparseable: <text> }`, which fails validation and takes the retry path instead of throwing (Task 1 test).
4. Protected elements never reach the model: the user content lists only `editableElements`; a protected element present in the manifest but absent from `editableElements` does not appear anywhere in the request (Task 1 test).
5. Usage is never under-reported: when `usage.iterations` is present (a fallback ran), cost sums every iteration at its own model's price; an unknown model is priced at the most expensive table entry (Task 1 test).

---

### Task 1: Claude analysis adapter

**Files:**
- Create: `workers/optimizer/src/claude/analysis.ts` (adapter), `workers/optimizer/src/claude/prompt.ts` (system prompt, user-content renderer, `PROPOSAL_JSON_SCHEMA`), `workers/optimizer/src/claude/pricing.ts`, `workers/optimizer/test/claude-analysis.test.ts`
- Modify: `workers/optimizer/package.json` (dependency `@anthropic-ai/sdk`), `package-lock.json`

**Interfaces:**
- Consumes: `AnalysisAdapter`, `AnalysisInput`, `RawFeedbackProposal`, `UsageReport`, `MutationOp`, `RiskClass` from `@ghostloop/contracts`; `validatePacket` (tests only).
- Produces:
  - `CLAUDE_ANALYSIS_MODEL = "claude-opus-5-5"`
  - `createClaudeAnalysis(opts?: { client?: Anthropic; model?: string; now?: () => number }): AnalysisAdapter` — `client` defaults to `new Anthropic()` created lazily on the first call (so constructing the adapter never throws without credentials); `now` defaults to `Date.now`.
  - `class ClaudeAnalysisError extends Error` with `kind: "refusal" | "truncated"`; messages `Claude refused the analysis request (category: <category or "none">)` and `Claude analysis output was truncated (max_tokens)`.
  - `PROPOSAL_JSON_SCHEMA` (exported const, plain JSON Schema object): `{ hypotheses: [{ statement, observationIds: string[], confidence?: "low"|"medium"|"high" }], patches: anyOf one variant per `MutationOp` value with `{ targetElementId, op: const, value, observationIds: string[], rationale, modelRisk?: RiskClass }` }`; `value` is `string` for `set_label`/`set_style_token`, `integer` for `set_order`, `boolean` for `set_visibility`; root and every object `additionalProperties: false` with `required` listing every non-optional field.
  - `SYSTEM_PROMPT: string` and `renderAnalysisInput(input: AnalysisInput): string` (deterministic: same input → same string).
  - `priceUsd(model: string, usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }): number` with per-MTok prices: `claude-opus-5-5` input 4, output 20, cache read 0.20, cache write 5; `claude-opus-5` and `claude-opus-4-8` input 5, output 25, cache read 0.50, cache write 6.25; `claude-fable-5-1` input 10, output 50, cache read 1.00, cache write 12.50; an unknown model is priced as `claude-fable-5-1`.

**Behavior of `proposeFeedback(input)`:**
1. `t0 = now()`; one `client.beta.messages.create({...}, { timeout: 180000 })` with the Global Constraints request shape, `system: SYSTEM_PROMPT`, `messages: [{ role: "user", content: renderAnalysisInput(input) }]`.
2. `stop_reason === "refusal"` → throw `ClaudeAnalysisError("refusal")` using `stop_details?.category`; `"max_tokens"` → throw `ClaudeAnalysisError("truncated")`.
3. Join the `text` blocks; `JSON.parse` it → `raw`. If parsing fails (or there is no text), `raw = { unparseable: text }`.
4. `usage`: `inferenceCalls: 1`, `inferenceUsd` = sum of `priceUsd(entry model, entry usage)` over `usage.iterations` when present and non-empty (check the SDK type for the iteration entry's model/usage fields), otherwise `priceUsd(response.model, response.usage)`; `wallClockMs: now() - t0`.
5. Return `{ raw, usage }`. SDK errors (auth, 4xx, retries exhausted) propagate unchanged.

**Prompt content** (`prompt.ts`; wording is the builder's, these points are required): Claude is analysing recorded synthetic-user sessions for a design experiment; observations are neutral counts, and its explanations are hypotheses, not facts; every hypothesis and patch cites at least one observation id from the list; patches only target listed editable elements and only use each element's `supportedOps`; value types per op; `set_style_token` values are design-token names like `button.primary`; never weaken protected constraints (signup, prices, auth, consent, validation, the success checker); prefer one to three small, targeted patches; `modelRisk` is optional advice that code may override. `renderAnalysisInput` emits task, intent constraints, protected constraints, observations (`id`, `kind`, `statement`, `numerator`, `denominator`, `screens`, `elementIds`, `interpretation` if present), and editable elements (`elementId`, `screen`, `role`, `label` if present, `supportedOps`) — as one JSON document with a fixed key order.

- [ ] **Step 1: Failing tests** in `claude-analysis.test.ts`, using a stub client (`{ beta: { messages: { create: vi.fn() } } } as unknown as Anthropic`) and inputs built from `@ghostloop/contracts/fixtures` (`observations.json`, `manifest.base.json`, `protocol.default.json`):
  - request shape: `model === "claude-opus-5-5"`, `max_tokens === 16000`, `betas` contains `"server-side-fallback-2026-07-01"`, `fallbacks === "default"`, `output_config.effort === "high"`, `output_config.format.type === "json_schema"`, no `temperature`, no `thinking`, options `timeout === 180000`.
  - user content contains every input observation id and every editable element id; a manifest element left out of `editableElements` (e.g. `plan.pro.price`) appears nowhere in the request JSON.
  - `renderAnalysisInput` is deterministic (same input twice → identical string).
  - a stub response whose text is `JSON.stringify(defaultProposal(input))` (from `src/mocks/analysis.ts`) → `raw` equals that object, and `validatePacket(raw, …)` returns `ok: true` with the protected-price patch blocked.
  - a stub response citing `obs_unknown` → adapter returns it; `validatePacket` returns `ok: false` with an error mentioning `obs_unknown`.
  - non-JSON text `"I think…"` → `raw` deep-equals `{ unparseable: "I think…" }` and `validatePacket` fails.
  - `stop_reason: "refusal"`, `stop_details: { category: "cyber" }` → rejects `ClaudeAnalysisError` matching `/refused.*cyber/`; `stop_reason: "max_tokens"` → rejects `/truncated/`.
  - usage: model `claude-opus-5-5`, 10000 input + 2000 output → `inferenceUsd` 0.08 (±1e-9), `inferenceCalls` 1, `wallClockMs` from a `now` stub returning 1000 then 1750 → 750; with `usage.iterations` of a declined `claude-opus-5-5` attempt (1000 in, 0 out) plus a `claude-opus-4-8` attempt (1000 in, 1000 out) → 0.004 + 0.005 + 0.025 = 0.034; an unknown model prices at the `claude-fable-5-1` rates.
  - schema drift: `PROPOSAL_JSON_SCHEMA` has exactly one patch variant per `MutationOp.options` value; every object in it has `additionalProperties: false`.
  - constructing `createClaudeAnalysis()` with no client and no credentials does not throw.
- [ ] **Step 2:** Run `npm test -w @ghostloop/optimizer -- claude-analysis`; expected FAIL (module missing).
- [ ] **Step 3:** `npm install @anthropic-ai/sdk -w @ghostloop/optimizer`, implement the three files.
- [ ] **Step 4:** Tests pass; root `npm run check` passes with no key set.
- [ ] **Step 5:** Commit `feat(optimizer): Claude analysis adapter`.

### Task 2: `--analysis claude` wiring, live smoke test, docs

**Files:**
- Modify: `workers/optimizer/src/mocks/index.ts`, `workers/optimizer/src/cli/demo-mock.ts`, `workers/optimizer/src/cli/worker.ts`, `workers/optimizer/src/worker.ts` (only if needed to accept the analysis choice), `workers/optimizer/test/demo-mock.test.ts`, `workers/optimizer/README.md`, root `package.json`
- Create: `workers/optimizer/src/claude/select.ts`, `workers/optimizer/test/claude-analysis.live.test.ts`

**Interfaces:**
- Consumes: `createClaudeAnalysis`, `CLAUDE_ANALYSIS_MODEL` (Task 1); `createMockAdapters`, `startWorker`, demo `main`.
- Produces:
  - `parseAnalysisFlag(argv: string[]): "mock" | "claude"` — `--analysis` absent → `"mock"`; any other value throws `--analysis must be one of: mock, claude`.
  - `selectAnalysis(choice: "mock" | "claude", opts?: { client?: Anthropic; warn?: (line: string) => void }): AnalysisAdapter` — `"claude"` returns `createClaudeAnalysis({ client })` and, when neither `ANTHROPIC_API_KEY` nor `ANTHROPIC_AUTH_TOKEN` is set, calls `warn("ANTHROPIC_API_KEY is not set; the Claude call will fail unless an `ant auth login` profile is active")`; `"mock"` returns `createMockAnalysis([], 0.05)`.
  - `createMockAdapters(candidate, opts)` gains `opts.analysis?: AnalysisAdapter` (default unchanged).
  - Demo: `main(argv, log, opts)` accepts `--analysis`; `opts.analysisClient?: Anthropic` for tests. Prints `analysis: mock` or `analysis: Claude (claude-opus-5-5)` right after the existing `candidate fixture:` line; when the run stops before `awaiting_approval`, the error it throws includes the stopping reason and detail.
  - Worker CLI: `npm run worker -- --analysis claude` (parses `process.argv`); banner line names the analysis mode. `startWorker` options gain `analysis?: AnalysisAdapter` if not already covered by `adapters`.
  - Root scripts: `"test:claude": "ANTHROPIC_LIVE_TEST=1 npm test -w @ghostloop/optimizer -- claude-analysis.live"`.

- [ ] **Step 1: Tests** (no network):
  - `parseAnalysisFlag` default, `claude`, and `--analysis bogus` rejecting with the exact message.
  - demo `main(["--analysis", "claude"], log, { analysisClient })` with a stub client returning `defaultProposal`-shaped JSON reaches the same summary as the mock run (`decision: "accepted"`, `stoppingReason: "USER_STOP"`) and logs `analysis: Claude (claude-opus-5-5)`.
  - Review Focus 1: same with a stub whose `create` rejects `new Anthropic.AuthenticationError(...)` (construct per the SDK's error constructor) → `main` rejects with a message containing `INTEGRATION_FAILURE` and the SDK error text; with both env vars unset, the warning line was logged (save and restore env vars).
  - demo default (no flag) output is unchanged (existing assertions).
- [ ] **Step 2: Live smoke test** `claude-analysis.live.test.ts`, `describe.skipIf(!process.env.ANTHROPIC_LIVE_TEST)`: a real `createClaudeAnalysis()` call with the fixture input; assert `validatePacket` → `ok: true`, at least one patch not `blocked`, every hypothesis labelled `"hypothesis"`, `usage.inferenceUsd > 0`; log the cost. Timeout 240000 ms.
- [ ] **Step 3:** Implement; `npm run check` passes with no key. If `ANTHROPIC_API_KEY` is set in the environment, also run `npm run test:claude` and record the result and cost in the report; if not, say so.
- [ ] **Step 4: README** (optimizer): a "Claude analysis" section — credentials (`export ANTHROPIC_API_KEY=...` or `ant auth login`; never commit keys, `.env*` is git-ignored), `npm run demo:mock -- --analysis claude [--store spacetime]`, `npm run worker -- --analysis claude`, `npm run test:claude` (spends real money, about cents per call), the model and that refusals fall back server-side, and that Claude's output is untrusted: code validates IDs, assigns risk and blocks protected changes.
- [ ] **Step 5:** Commit `feat(optimizer): --analysis claude for demo and worker`.

## Calls (controller decisions, user skipped the questions)

- C1: `claude-opus-5-5` at effort `high` — the skill's default model; analysis quality matters more than cost at one call per round.
- C2: static output schema instead of per-request enums of allowed IDs — no per-run schema compilation; `validatePacket` already rejects unknown IDs and the controller retries once.
- C3: refusal and truncation throw (→ `INTEGRATION_FAILURE`); unparseable text returns `{ unparseable }` (→ validation retry) — a refusal won't be fixed by asking again, malformed output might.
- C4: server-side refusal fallback `"default"` on by default.
- C5: no prompt caching — one call per round and a system prompt below the cacheable minimum.
- C6: stacked on PR #7's branch so the worker CLI can take the flag.
- C7: live API test gated on `ANTHROPIC_LIVE_TEST=1`; nothing else touches the network.
