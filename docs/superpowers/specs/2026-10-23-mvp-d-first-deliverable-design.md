# MVP D — First Deliverable: Contracts, Evaluator, Policy, Mock Controller Round

**Issue:** #4 (MVP D · Storage, evaluation, and optimization)
**Date:** 2026-10-23
**Sources of truth:** `docs/PROJECT-PRD.md` (§7–15, 21–22), `docs/MERGE-PLAN.md`, issue #4.

## 1. Intent

D is the coordinator that connects GhostLoop: run a baseline, summarize recorded behavior, ask Claude for a focused change, wait for designer approval, have C create a candidate, retest it with fresh B sessions, and decide — in code, never by the model — whether to keep it.

The four teammates work independently. Everyone else codes against D's contracts without coordinating in real time, so the contracts must land on `main` first, be easy to read, and stay stable.

This document covers the **first deliverable** only:

1. Root npm workspace skeleton + `packages/contracts` (types, runtime validators, adapter signatures, command shapes, fixtures) → merged to `main` as its own PR.
2. `workers/optimizer`: deterministic evaluator, observation aggregator, mutation policy, and one complete controller round driven by **mock** simulation / model / candidate adapters and an **in-memory** store.

Out of scope here (later slices on this issue): SpacetimeDB module and generated bindings, the real Claude adapter, real B/C adapters, dashboard integration, multi-round auto mode, parallel candidates.

## 2. Goals, non-goals, anti-goals

**Goals**
- One shared, versioned schema for every PRD §8 entity plus the issue's additions, with runtime validation.
- Fixtures every teammate can load today, each validated by a test.
- A controller round that exercises approval, partial selection, rejection, inconclusive, cancellation, budget exhaustion, and integration failure — with version history preserved.
- Metric arithmetic that is exactly right: the 4 goal / 4 behavioral failure / 2 infra / 1 cancel fixture reports **4/8 = 50%**, 2 infra, 1 cancelled.

**Non-goals**
- Statistical significance testing. The improvement margin is a configurable heuristic.
- Persistence beyond process memory (SpacetimeDB is the next slice; the store interface is shaped for it).
- Live model or browser calls.

**Anti-goals (failure even if it "works")**
- The model can declare success, set a patch's risk lower than code does, or cause any mutation without required approval.
- A score improves by changing the success definition or touching protected elements.
- Zero valid sessions or an incomplete batch renders as 0% or as a win.
- Duplicate events inflate counts; a stale approval mutates a different incumbent.
- Hidden goal implementation reaches anything model-facing.

## 3. Decided constraints

- **npm workspaces**, Node 22 (`.nvmrc`), ESM, TypeScript strict. Communicated to A on issue #1; A owns root config afterward.
- Root `package.json` declares workspaces `packages/*`, `workers/*`, `apps/*` and minimal scripts: `check` (typecheck + test across workspaces), `test`.
- **zod** for schemas; TS types are `z.infer` of the schemas so the two never drift. **vitest** for tests. **tsx** to run scripts.
- Package names: `@ghostloop/contracts`, `@ghostloop/optimizer`.
- Contracts ship as TS source consumed via workspace (no build step required for consumers; `tsc --noEmit` for checking). Builder may add a build if a consumer needs one.

## 4. `packages/contracts`

### 4.1 Layout

```
packages/contracts/
  src/
    version.ts          SCHEMA_VERSION = "1.0.0"
    ids.ts              branded ID schemas + prefixes
    enums.ts            all enums (below)
    protocol.ts         ExperimentProtocol, Scenario, EvaluationPolicy, Budgets
    hidden.ts           HiddenGoalSpec (separate entry point)
    agent.ts            PublicAgentInput, AgentAction, AgentActionEvent, AgentRunResult
    simulation.ts       BatchRequest, BatchResult, UsageReport, SimulationAdapter
    analysis.ts         ObservationTrend, Hypothesis, MutationPatch, DesignFeedbackPacket, AnalysisAdapter
    candidate.ts        CandidateDesign, ValidationResult, FigmaReference, CandidateAdapter
    manifest.ts         DesignManifest, ManifestElement (element catalog per version)
    evaluation.ts       RunMetrics, Evaluation, GuardrailResult
    experiment.ts       Experiment record, StateTransition, StoppingRecord
    commands.ts         designer command payloads + results
    index.ts            public exports (does NOT re-export hidden.ts)
  fixtures/
    README.md           provenance + what each fixture demonstrates
    *.json
  test/
    fixtures.test.ts    every fixture parses against its schema
```

`package.json` `exports`: `"."` → `src/index.ts`, `"./hidden"` → `src/hidden.ts`, `"./fixtures/*"` → fixture JSON.

### 4.2 Conventions

- Every top-level record carries `schemaVersion` (literal `"1.0.0"`).
- IDs are strings with readable prefixes: `exp_`, `ver_`, `scn_`, `run_`, `obs_`, `hyp_`, `pat_`, `cand_`, `val_`, `eval_`, `appr_`. Schemas check the prefix.
- Timestamps are ISO-8601 UTC strings.
- Action events carry `runId` + `seq` (0-based, contiguous per run); `(runId, seq)` is the dedupe key.
- Screenshots are references (`{ uri: string, width, height }`), never blobs.

### 4.3 Enums

| Enum | Values |
|---|---|
| `RunOutcome` | `goal`, `agent_stop`, `step_limit`, `flow_blocked`, `model_error`, `browser_error`, `user_cancelled` |
| `ActionType` | `click`, `type`, `select`, `stop` |
| `ActionResult` | `ok`, `validation_error`, `no_effect`, `rejected_invalid` |
| `ExperimentState` | `created`, `baseline_running`, `observing`, `diagnosing`, `proposing`, `awaiting_approval`, `patching`, `validating`, `candidate_running`, `comparing`, `accepted`, `rejected`, `inconclusive`, `stopped` |
| `StoppingReason` | `TARGET_MET`, `ITERATION_BUDGET`, `COST_BUDGET`, `TIME_BUDGET`, `NO_VALID_PATCH`, `NO_MEASURED_IMPROVEMENT`, `INCONCLUSIVE`, `USER_STOP`, `INTEGRATION_FAILURE` |
| `ReviewMode` | `manual`, `auto` |
| `MutationOp` | `set_label`, `set_style_token`, `set_order`, `set_visibility` |
| `RiskClass` | `low`, `review_required`, `blocked`, `unknown` |
| `PatchState` | `proposed`, `blocked`, `approved`, `declined`, `applied` |
| `ObservationDisposition` | `unreviewed`, `confirmed`, `intentional`, `not_relevant` |
| `EvaluationDecision` | `accepted`, `rejected`, `inconclusive` |
| `CandidateReviewStatus` | `pending`, `promoted_measured`, `retained_aesthetic`, `discarded` |
| `FigmaStatus` | `verified`, `pending`, `mismatch`, `unavailable` |

### 4.4 Entities (field-level; PRD §8 is the minimum)

- **Scenario**: `id`, `name`, `description` (model-facing persona/situation), `inputs` (fictional data the agent may type, e.g. email), `runs` (allocation count).
- **EvaluationPolicy** (frozen before baseline): `targetCompletionRate` (0–1), `minImprovementPp` (default 10), `maxMedianActionsIncrease` (default 2), `maxValidationErrorRateIncreasePp` (default 15), `minValidFraction` (default 0.75 of planned runs), `minValidPerScenario` (default 1).
- **Budgets**: `maxActionsPerRun`, `runsPerBatch`, `maxConcurrency`, `maxIterations`, `maxCandidates`, `maxInferenceUsd`, `maxWallClockMs`.
- **ExperimentProtocol**: `id`, `experimentId`, `baseVersionId`, `task` (model-facing text), `hiddenGoalRef` (opaque ID only), `allowedPaths` (screen IDs), `intentConstraints` (strings), `protectedElements` (element IDs), `protectedCategories` (`signup`, `pricing`, `auth`, `consent`, `validation`, `checker`), `approvedStyleTokens` (token names), `mode`, `scenarios`, `budgets`, `policy`, `frozenAt`.
- **HiddenGoalSpec** (`hidden.ts` only): `ref`, `description`, `checkerId`. Only B/C's trusted checker consumes it. Nothing in `index.ts` references this type.
- **PublicAgentInput**: `runId`, `task`, `scenario` (description + inputs), `screenshot`, `controls[]` (`elementId`, `role`, `label`, `enabled`), `previousActions[]`, `remainingActions`. Structurally excludes hidden goal and allowed paths.
- **AgentAction**: `type`, `elementId?`, `value?`, `reason?`.
- **AgentActionEvent**: `runId`, `seq`, `at`, `versionId`, `screenBefore`, `screenAfter`, `action`, `result`, `pointer?` (`{x,y}` — omitted when unknown, never invented), `viewport` (`{width,height}`), `screenshot?`.
- **AgentRunResult**: `runId`, `experimentId`, `protocolId`, `versionId`, `scenarioId`, `batchId`, `events[]`, `goalVerified` (boolean from checker), `goalEvidence?`, `stepCount`, `outcome`, `terminalScreen`, `lastPointer?`, `screenshots[]`, `behaviorallyValid` (derived: true for goal/agent_stop/step_limit/flow_blocked), `startedAt`, `endedAt`. Validation enforces: `outcome === "goal"` ⇔ `goalVerified === true`; `behaviorallyValid` matches outcome.
- **UsageReport**: `inferenceCalls`, `inferenceUsd`, `wallClockMs`.
- **BatchRequest**: `batchId`, `protocolId`, `versionId`, `versionUrl`, `task`, `scenarios`, `runsPerBatch`, `maxActionsPerRun`, `maxConcurrency`, `hiddenGoalRef`.
- **BatchResult**: `batchId`, `versionId`, `runs[]`, `usage`, `cancelled` (boolean), `plannedRuns`.
- **ObservationTrend**: `id`, `versionId`, `batchId`, `kind` (e.g. `outcome_count`, `screen_revisit`, `repeated_failed_action`, `validation_error`, `step_limit`), `statement` (neutral), `numerator`, `denominator`, `traceRefs[]` (`{runId, seq?}`), `screens[]`, `elementIds[]`, `interpretation?`, `disposition`, `fingerprint` (stable key: kind + screens + elements, used to suppress repeats).
- **Hypothesis**: `id`, `observationIds[]`, `statement`, `label: "hypothesis"` (literal), `confidence?` (`low|medium|high`).
- **MutationPatch**: `id`, `sourceVersionId`, `targetElementId`, `op`, `value` (string for label/token; number for order; boolean for visibility — discriminated by `op`), `observationIds[]`, `rationale`, `modelRisk?` (advisory only), `risk` (assigned by code), `state`, `blockReason?`.
- **DesignFeedbackPacket**: `id`, `versionId`, `figmaRef?`, `task`, `intentConstraints`, `observations[]` (IDs + statements), `traceEvidence[]`, `hypotheses[]`, `patches[]`, `protectedConstraints`, `reviewPolicy` (`manual_required` | `auto_low_risk`), `createdAt`.
- **CandidateDesign**: `id`, `versionId` (new immutable version), `parentVersionId`, `patchIds[]`, `url`, `figma?` (`{frameUrl, status, manifestHash, patchIds}`), `reviewStatus`, `evaluationId?`, `createdAt`.
- **ValidationResult**: `candidateId`, `ok`, `checks[]` (`{name, kind, passed, detail?}`), `at`. `kind` is `runnable` (build, render, smoke — can the candidate run at all) or `guardrail` (protected requirements, accessibility, approved tokens).
- **RunMetrics**: `versionId`, `batchId`, `plannedRuns`, `validRuns`, `successes`, `completionRate` (`number | null` — null when `validRuns === 0`), `outcomeCounts` (all 7 outcomes), `infraErrors`, `cancelled`, `medianActionsToSuccess` (`number | null`), `backtrackRuns`, `validationErrorRuns`, `perScenario[]` (same shape, scoped), `complete` (boolean), `incompleteReason?`.
- **Evaluation**: `id`, `experimentId`, `protocolId`, `baselineVersionId`, `candidateVersionId`, `baseline: RunMetrics`, `candidate: RunMetrics`, `guardrails[]`, `deltaPp` (`number | null`), `decision`, `reasons[]`, `stoppingReason`, `at`.
- **DesignManifest** (C produces from its canonical manifest/control registry; D consumes): `versionId`, `parentVersionId?`, `manifestHash`, `elements[]`. **ManifestElement**: `elementId`, `screen`, `role`, `label?`, `protected` (boolean), `categories[]` (subset of protected categories, e.g. `["pricing"]`), `supportedOps[]` (ops C allows on it). This is the authoritative element list for patch validation and protected-category mapping.
- **Experiment**: `id`, `protocol`, `state`, `incumbentVersionId`, `round`, `transitions[]` (`{from, to, at, note?}`), `usage` (cumulative), `stopping?` (`{reason, at, bestVersionId, attemptedCandidateIds, rejectedPatchIds, remainingObservationIds}`).

### 4.5 Adapter signatures (frozen for B/C; details refined with owners)

```ts
interface SimulationAdapter {            // B implements
  runBatch(req: BatchRequest, onEvent: (e: AgentActionEvent) => void, signal: AbortSignal): Promise<BatchResult>;
}
interface CandidateAdapter {             // C implements
  createCandidate(sourceVersionId: string, approvedPatches: MutationPatch[]): Promise<CandidateDesign>;
  validateCandidate(candidateId: string): Promise<ValidationResult>;
  getManifest(versionId: string): Promise<DesignManifest>;
}
interface AnalysisAdapter {              // D implements with Claude later; returns unvalidated JSON
  proposeFeedback(input: AnalysisInput): Promise<{ raw: unknown; usage: UsageReport }>;
}
```

Rejections/throws from adapters are integration failures; the controller does not interpret error message text.

### 4.6 Designer commands (A → D)

Payload schemas + result union (`{ ok: true, ... } | { ok: false, code, message }`):

- `CreateExperiment { protocol (without frozenAt) }`
- `StartExperiment { experimentId }`
- `CancelExperiment { experimentId, reason? }`
- `SetObservationDisposition { experimentId, observationId, disposition }`
- `ApprovePatches { experimentId, sourceVersionId, round, patchIds[], approvedBy }`
- `RecordFinalReview { experimentId, candidateId, status: CandidateReviewStatus, note? }`

Error codes: `NOT_FOUND`, `INVALID_STATE`, `STALE_SOURCE_VERSION`, `ALREADY_APPROVED`, `UNKNOWN_PATCH`, `PATCH_BLOCKED`, `VALIDATION_FAILED`.

### 4.7 Fixtures

All labeled `"provenance": "synthetic-fixture"` (never presented as real evidence). Built around the demo task's five screens (`signup`, `workspace`, `plan`, `invite`, `done`) with stable element IDs (e.g. `plan.free.cta`, `plan.pro.cta`, `invite.email`, `invite.submit`). C owns final IDs; fixture IDs are placeholders noted in the README.

- `protocol.default.json` — 4 scenarios × 3 runs = 12, 8 actions, policy defaults.
- `runs/goal.json`, `runs/agent-stop.json`, `runs/step-limit.json`, `runs/flow-blocked.json`, `runs/model-error.json`, `runs/browser-error.json`, `runs/cancelled.json`.
- `batch.metrics-4-4-2-1.json` — 11 runs: 4 goal, 4 behavioral failure (mixed stop/step-limit/blocked), 2 infra, 1 cancelled → 4/8.
- `batch.baseline.json`, `batch.candidate-improved.json`, `batch.candidate-flat.json`, `batch.zero-valid.json`, `batch.underfilled.json`.
- `observations.json`, `feedback-packet.json` (two+ patches, one blocked), `approval.partial.json`.
- `candidate.json`, `validation.pass.json`, `validation.fail.json`.
- `evaluation.accepted.json`, `evaluation.rejected.json`, `evaluation.inconclusive.json`.
- `candidate.figma-mismatch.json`.

## 5. `workers/optimizer`

### 5.1 Layout

```
workers/optimizer/
  src/
    evaluator.ts     computeMetrics(), compare()
    observations.ts  aggregateObservations()
    policy.ts        classifyPatch(), validatePacket()
    store.ts         ExperimentStore interface + InMemoryStore
    controller.ts    runRound()
    commands.ts      command handlers (shared path for dashboard + dev CLI)
    mocks/           mock Simulation/Analysis/Candidate adapters (fixture-driven)
    cli/demo-mock.ts one full round in the terminal
  test/
```

### 5.2 Evaluator (`evaluator.ts`) — pure functions

`computeMetrics(runs, plannedRuns, policy, scenarios)`:
- Dedupe runs by `runId` (first wins) and events by `(runId, seq)` before counting.
- `validRuns` = outcomes in {goal, agent_stop, step_limit, flow_blocked}. `infraErrors` = model_error + browser_error. `cancelled` = user_cancelled. Excluded runs are reported, never in the denominator.
- `completionRate = successes / validRuns`, or `null` when `validRuns === 0`.
- `medianActionsToSuccess` over goal runs' deduped step counts; `null` if none.
- `backtrackRuns`: runs that revisit a previously left screen. `validationErrorRuns`: runs with ≥1 `validation_error` result.
- **Completeness rule (frozen in policy):** `complete` iff `validRuns ≥ ceil(minValidFraction × plannedRuns)` AND every scenario has `≥ minValidPerScenario` valid runs.

`compare(baseline, candidate, guardrails, policy)` → decision + reasons, in this order:
1. Any failed guardrail (candidate validation check) → `rejected`.
2. Either side incomplete or `completionRate === null` → `inconclusive`.
3. `deltaPp = (cand − base) × 100`.
4. Secondary regression (median actions up by more than `maxMedianActionsIncrease`, or validation-error-run rate up by more than `maxValidationErrorRateIncreasePp`) → `rejected`.
5. `deltaPp ≥ minImprovementPp` → `accepted`.
6. `deltaPp ≤ −minImprovementPp` → `rejected`.
7. Otherwise → `inconclusive`.

Stopping reason after a round: accepted ∧ candidate rate ≥ target → `TARGET_MET`; accepted ∧ `round ≥ maxIterations` → `ITERATION_BUDGET`; rejected → `NO_MEASURED_IMPROVEMENT`; inconclusive → `INCONCLUSIVE`. Accepted, below target, with rounds remaining: the experiment parks in `accepted` (round complete, no stopping record yet). A later multi-round slice adds "start next round"; for now the designer ends it with `CancelExperiment` → `USER_STOP`, which writes the full stopping record.

### 5.3 Observations (`observations.ts`) — deterministic, before any model call

From the baseline batch: outcome counts, screen revisits per screen, repeated failed actions on the same element, validation errors per element, step-limit hits. Each becomes a neutral statement ("5 of 12 runs revisited plan selection") with numerator/denominator, trace refs, screens, element IDs, and a fingerprint. Only behaviorally valid runs feed behavioral observations; infra/cancel counts are a separate outcome observation. Findings whose fingerprint was previously marked `intentional` or `not_relevant` are kept but flagged so the analysis input excludes them from recommendations. Dispositions are stored per app (keyed by fingerprint, not by experiment or version), so a disposition set in one experiment suppresses that finding in later experiments and rounds. In the single-round MVP the designer sets dispositions on an earlier experiment's findings; there is no pause between observing and diagnosing.

### 5.4 Mutation policy (`policy.ts`) — code is the authority

`classifyPatch(patch, protocol, manifest)` (manifest = incumbent version's `DesignManifest` from C):
- Element not in the manifest → `unknown` (manual review required; never auto; also fails packet validation as an unsupported reference).
- Element has `protected: true`, is in `protocol.protectedElements`, or any of its `categories` intersects `protocol.protectedCategories` → `blocked` (with `blockReason`).
- `op` not in the element's `supportedOps` → `blocked`.
- `set_style_token` with a token in `approvedStyleTokens` → `low`.
- `set_label`, `set_order`, `set_visibility`, or style token outside the allowlist → `review_required`.
- `modelRisk` is stored but never lowers the code-assigned class.

`validatePacket(raw, context)`: zod-parse; every `observationIds` entry must exist in this round's observations; every `targetElementId` must exist in the incumbent manifest; `sourceVersionId` must equal the incumbent; patches citing only suppressed findings are dropped; hypotheses must carry the literal `hypothesis` label. Unsupported references fail validation (packet rejected; one retry within inference budget, then `NO_VALID_PATCH`).

### 5.5 Store (`store.ts`)

`ExperimentStore` interface with one method group per PRD §14 table (experiments, design_versions, agent_runs, agent_actions, observations, hypotheses, patches, candidates, evaluations). `InMemoryStore` implements it with:
- unique `(runId, seq)` on actions (duplicate insert is a no-op),
- design versions insert-only (immutable lineage via `parentVersionId`),
- a subscription hook (`onChange`) so the mock CLI and later the SpacetimeDB adapter share the shape.

### 5.6 Controller (`controller.ts`)

The controller is a **resumable step machine driven from stored state**, not one long-lived promise. `step(experimentId, deps)` reads the experiment from the store, performs the work for its current state, persists results plus the transition, and returns. A driver (`drive(experimentId, deps)`) calls `step` repeatedly until the state is `awaiting_approval` (it parks there) or a terminal state. `StartExperiment` launches the driver; a successful `ApprovePatches` records the approval and relaunches it. A restarted process can resume any non-terminal experiment by calling `drive`. States that call long adapters (`baseline_running`, `candidate_running`) restart their batch on resume with a new `batchId`; partial batches are kept but excluded from evaluation. This shape maps onto SpacetimeDB reducers (commands) plus an external worker (the driver) in the next slice.

`deps = { store, simulation, analysis, candidates, clock, signal }`. States:

`created → baseline_running → observing → diagnosing → proposing → awaiting_approval → patching → validating → candidate_running → comparing → accepted | rejected | inconclusive → stopped`

- Every transition is appended to `experiment.transitions` via the store.
- **Approval gate:** in `awaiting_approval` the controller waits for an `ApprovePatches` command (through `commands.ts`, the same path A will call). Approval is accepted only if: state is `awaiting_approval`, `sourceVersionId === incumbentVersionId`, `round` matches, every patch ID exists in this round and is not `blocked`, and no approval for this round exists yet (prevents a second candidate). Manual mode requires approval for every patch regardless of risk. Auto mode (not built now) would auto-approve only `low`.
- Empty approval (designer declines all) → stop with `NO_VALID_PATCH`.
- Only approved patches go to `createCandidate`, against the incumbent version.
- Any failed `runnable` check, or any adapter throw → stop with `INTEGRATION_FAILURE`, no retest, no Evaluation; incumbent unchanged.
- Any failed `guardrail` check → no retest; write an Evaluation with decision `rejected` (candidate metrics omitted) and stop with `NO_VALID_PATCH`; incumbent unchanged. (This is what §5.2 step 1 refers to; `compare` also receives guardrails so it stays correct if called directly.)
- Candidate retest uses the **same frozen protocol** with a new `batchId` and new run IDs.
- Accepted → the candidate is the **measured winner** and eligible for promotion, but the incumbent does **not** change yet; candidate `reviewStatus` stays `pending`. Rejected/inconclusive → incumbent unchanged, never a measured winner.
- **Final review (`RecordFinalReview`)** is the only path that moves the incumbent:
  - `promoted_measured` — allowed only when the candidate's Evaluation decision is `accepted`; sets `incumbentVersionId` to the candidate version.
  - `retained_aesthetic` — allowed for any candidate that passed guardrails; kept in history as a designer preference, never labeled as a measured improvement; incumbent unchanged.
  - `discarded` — candidate kept in history; incumbent unchanged.
  - A second final review for the same candidate → `ALREADY_APPROVED`. "Best accepted version" in the stopping record = the latest `promoted_measured` version, else the base version.
- **Cancellation:** `CancelExperiment` aborts the shared `AbortController`; in-flight `runBatch` receives the signal; partial results are kept; controller transitions to `stopped` with `USER_STOP` and starts no further work.
- **Budgets:** checked before each step and after each adapter call against cumulative usage — inference USD → `COST_BUDGET`, wall clock → `TIME_BUDGET`, candidates → `ITERATION_BUDGET`. Per-run action/concurrency limits are passed to B in `BatchRequest`.
- Final stopping record persists best accepted version, attempted candidates, evaluations, rejected/blocked patches, and remaining (unaddressed) observations.

### 5.7 Mocks and demo

Mock adapters replay fixtures (configurable to return improved/flat/zero-valid/underfilled batches, valid/invalid packets, passing/failing validation, or throw). `npm run demo:mock -w @ghostloop/optimizer` runs one round, auto-submits a partial approval through `commands.ts`, and prints transitions, metrics, decision, and stopping reason. Clearly labeled as mock.

## 6. Tests that must exist

- Every fixture parses.
- 4/4/2/1 → 4/8 = 0.5, infra 2, cancelled 1.
- Duplicate runs/events don't change metrics.
- Zero valid → rate `null`, decision `inconclusive`; underfilled → `inconclusive`.
- Guardrail fail → `rejected`; +5pp → `inconclusive`; +15pp → `accepted`; secondary regression → `rejected`.
- Protected element / protected category → `blocked`; unknown element → `unknown`; model `modelRisk: "low"` on a label change stays `review_required`.
- Packet citing nonexistent observation or element → rejected.
- Controller: no `createCandidate` call before approval; only selected patch IDs passed; stale `sourceVersionId` → `STALE_SOURCE_VERSION`; second approval → `ALREADY_APPROVED`; cancel mid-baseline → `USER_STOP`, no further adapter calls; cost budget exceeded → `COST_BUDGET`; validation fail → `INTEGRATION_FAILURE` with incumbent preserved; rejected round preserves version history.

## 7. Delivery

- **PR 1 (→ main, `Refs #4`):** root workspace skeleton (`package.json`, `.nvmrc`, `.gitignore`, `tsconfig.base.json`), `packages/contracts` with fixtures, tests, and README (setup, commands, integration checklist for A/B/C).
- **PR 2 (`Refs #4`):** `workers/optimizer` per §5 with README.
- Neither PR closes #4.

## 8. Left to the builder

Internal helper structure, exact zod idioms, test file organization, mock configuration API, fixture content details beyond what §4.7 requires, CLI output format.

## 9. Calls made by the author (review these)

- Element catalog comes from C's manifest via `CandidateAdapter.getManifest(versionId)`; protected-category mapping is a per-element `categories` tag C supplies. Untagged/unknown elements fail safe (`unknown` / unsupported reference).
- Controller is a resumable step machine over stored state, so it survives restarts and maps onto SpacetimeDB reducers + an external worker later.
- Validation checks split into `runnable` (failure → `INTEGRATION_FAILURE`) and `guardrail` (failure → `rejected`, `NO_VALID_PATCH`). Neither runs a retest.
- Accepted-but-below-target with rounds remaining parks in `accepted` until the multi-round slice; cancel gives `USER_STOP`.
- Observation dispositions are app-wide, keyed by fingerprint.

Decided by the user: an `accepted` evaluation makes a candidate eligible; only a designer's `promoted_measured` final review changes the incumbent.
