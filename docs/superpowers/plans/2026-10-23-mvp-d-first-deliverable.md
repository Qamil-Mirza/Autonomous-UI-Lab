# MVP D First Deliverable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship GhostLoop's shared contracts + fixtures (PR 1 → main) and a deterministic optimizer worker that runs one full controller round on mock adapters (PR 2).

**Architecture:** `packages/contracts` holds zod schemas (TS types are `z.infer`), adapter interfaces, command shapes and JSON fixtures. `workers/optimizer` holds pure evaluator/observation/policy modules, an async `ExperimentStore` interface with an in-memory implementation, command handlers, and a resumable step-machine controller driven from stored state.

**Tech Stack:** npm workspaces, Node 22, TypeScript (strict, ESM, `moduleResolution: "Bundler"`, `noEmit`), zod 3, vitest, tsx.

**Spec:** `docs/superpowers/specs/2026-10-23-mvp-d-first-deliverable-design.md` — read it alongside this plan; field lists in spec §4.4 are authoritative and are not repeated here.

## Global Constraints

- Package names: `@ghostloop/contracts`, `@ghostloop/optimizer`. Workspaces: `packages/*`, `workers/*`, `apps/*`.
- `SCHEMA_VERSION = "1.0.0"`; every top-level record carries `schemaVersion: "1.0.0"`.
- ID prefixes: `exp_ ver_ scn_ run_ obs_ hyp_ pat_ cand_ val_ eval_ appr_ batch_ proto_`.
- Timestamps: ISO-8601 UTC strings. Screenshots: references only.
- Behaviorally valid outcomes: `goal`, `agent_stop`, `step_limit`, `flow_blocked`. Infra: `model_error`, `browser_error`. Excluded separately: `user_cancelled`.
- Policy defaults: `minImprovementPp 10`, `maxMedianActionsIncrease 2`, `maxValidationErrorRateIncreasePp 15`, `minValidFraction 0.75`, `minValidPerScenario 1`.
- `@ghostloop/contracts` index must not export anything from `hidden.ts`.
- Code-assigned risk is authoritative; `modelRisk` never lowers it. Claude never assigns IDs, `sourceVersionId`, or risk.
- Only `RecordFinalReview { status: "promoted_measured" }` on an `accepted` candidate changes `incumbentVersionId`.
- All fixtures carry `"provenance": "synthetic-fixture"`.
- Commits reference `Refs #4`. Neither PR closes #4.

## Review Focus

1. Events arriving out of order or duplicated through `onEvent` (seq 3 before 2, seq 2 twice) → stored once, replayed in seq order; metrics unchanged. *Test in Task 7.*
2. A resumed `baseline_running` leaves a partial batch behind → only the latest batch for that phase is evaluated; partial runs never enter the denominator. *Test in Task 10.*
3. Cancel while parked in `awaiting_approval` → `stopped`/`USER_STOP`, and a later `ApprovePatches` returns `INVALID_STATE` without calling `createCandidate`. *Test in Task 10.*
4. Approval naming a patch from another round or experiment → `UNKNOWN_PATCH`, nothing recorded. *Test in Task 9.*
5. Even number of successful runs → median is the mean of the two middle step counts (e.g. [4,6] → 5). *Test in Task 5.*

---

## PR 1 — Workspace + contracts (branch `feat/optimizer-contracts`)

### Task 1: Workspace skeleton and contracts primitives

**Files:**
- Create: `package.json`, `.nvmrc`, `.gitignore`, `tsconfig.base.json`
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/version.ts`, `src/ids.ts`, `src/enums.ts`
- Test: `packages/contracts/test/primitives.test.ts`

**Interfaces:**
- Produces: `SCHEMA_VERSION`, `SchemaVersion` (zod literal); `idSchema(prefix)`; named ID schemas `ExperimentId, VersionId, ScenarioId, RunId, ObservationId, HypothesisId, PatchId, CandidateId, ValidationId, EvaluationId, ApprovalId, BatchId, ProtocolId`; `newId(prefix)` (prefix + `crypto.randomUUID()` without dashes, first 12 chars); enum schemas from spec §4.3 named exactly `RunOutcome, ActionType, ActionResult, ExperimentState, StoppingReason, ReviewMode, MutationOp, RiskClass, PatchState, ObservationDisposition, EvaluationDecision, CandidateReviewStatus, FigmaStatus`, plus `ProtectedCategory` (`signup|pricing|auth|consent|validation|checker`) and `CheckKind` (`runnable|guardrail`); constants `BEHAVIORAL_OUTCOMES`, `INFRA_OUTCOMES`.

- [ ] **Step 1: Create root files.** Root `package.json`: `"private": true`, `"type": "module"`, `"workspaces": ["packages/*","workers/*","apps/*"]`, `"engines": {"node": ">=22"}`, scripts `"check": "npm run check --workspaces --if-present"`, `"test": "npm run test --workspaces --if-present"`. `.nvmrc`: `22`. `.gitignore`: `node_modules/ dist/ .env* !.env.example coverage/ .DS_Store`. `tsconfig.base.json`: `strict, target ES2022, module ESNext, moduleResolution Bundler, resolveJsonModule, noEmit, skipLibCheck, noUncheckedIndexedAccess`.
- [ ] **Step 2: Create contracts package.** `package.json`: name `@ghostloop/contracts`, `"type":"module"`, `exports: {".": "./src/index.ts", "./hidden": "./src/hidden.ts", "./fixtures": "./fixtures/index.ts", "./fixtures/*": "./fixtures/*"}`, scripts `"check": "tsc -p . && vitest run"`, `"test": "vitest run"`, dependency `zod@^3`, devDependencies `typescript`, `vitest`, `@types/node`. Run `npm install` at root; commit `package-lock.json`.
- [ ] **Step 3: Write failing test**

```ts
import { describe, it, expect } from "vitest";
import { RunId, newId, RunOutcome, BEHAVIORAL_OUTCOMES, INFRA_OUTCOMES, SCHEMA_VERSION } from "../src/index";

describe("primitives", () => {
  it("checks id prefixes", () => {
    expect(RunId.safeParse("run_abc").success).toBe(true);
    expect(RunId.safeParse("exp_abc").success).toBe(false);
    expect(RunId.safeParse(newId("run")).success).toBe(true);
  });
  it("partitions outcomes", () => {
    expect(BEHAVIORAL_OUTCOMES).toEqual(["goal", "agent_stop", "step_limit", "flow_blocked"]);
    expect(INFRA_OUTCOMES).toEqual(["model_error", "browser_error"]);
    expect(RunOutcome.options).toHaveLength(7);
    expect(SCHEMA_VERSION).toBe("1.0.0");
  });
});
```

- [ ] **Step 4:** Run `npm test -w @ghostloop/contracts` → FAIL (module not found).
- [ ] **Step 5:** Implement `version.ts`, `ids.ts`, `enums.ts`, and a temporary `src/index.ts` re-exporting them.
- [ ] **Step 6:** Run `npm run check -w @ghostloop/contracts` → typecheck clean, tests PASS.
- [ ] **Step 7: Commit** `feat(contracts): workspace skeleton and primitives` (`Refs #4`).

### Task 2: Protocol, hidden goal, manifest schemas

**Files:**
- Create: `packages/contracts/src/protocol.ts`, `src/hidden.ts`, `src/manifest.ts`
- Test: `packages/contracts/test/protocol.test.ts`

**Interfaces:**
- Produces: `Scenario`, `EvaluationPolicy` (with `.default()`s from Global Constraints; `targetCompletionRate` required, 0–1), `Budgets`, `ExperimentProtocol`, `ExperimentProtocolDraft` (= protocol without `frozenAt`, `id`), `HiddenGoalSpec` (only in `hidden.ts`), `ManifestElement`, `DesignManifest`. Fields per spec §4.4. `ExperimentProtocol.hiddenGoalRef` is an opaque `string`.

- [ ] **Step 1: Write failing tests**

```ts
it("applies policy defaults", () => {
  const p = EvaluationPolicy.parse({ targetCompletionRate: 0.8 });
  expect(p).toMatchObject({ minImprovementPp: 10, maxMedianActionsIncrease: 2, maxValidationErrorRateIncreasePp: 15, minValidFraction: 0.75, minValidPerScenario: 1 });
});
it("rejects target outside 0..1", () => {
  expect(EvaluationPolicy.safeParse({ targetCompletionRate: 1.5 }).success).toBe(false);
});
it("protocol does not carry hidden goal description", () => {
  expect(Object.keys(ExperimentProtocol.shape)).not.toContain("hiddenGoal");
  expect(ExperimentProtocol.shape).toHaveProperty("hiddenGoalRef");
});
it("index does not export HiddenGoalSpec", async () => {
  const idx = await import("../src/index");
  expect("HiddenGoalSpec" in idx).toBe(false);
});
it("manifest element categories are protected categories", () => {
  expect(ManifestElement.safeParse({ elementId: "plan.free.cta", screen: "plan", role: "button", protected: false, categories: ["bogus"], supportedOps: ["set_label"] }).success).toBe(false);
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement the three files; export protocol + manifest from `index.ts`. **Step 4:** Run `npm run check -w @ghostloop/contracts` → PASS.
- [ ] **Step 5: Commit** `feat(contracts): protocol, hidden goal, manifest`.

### Task 3: Agent and simulation schemas

**Files:**
- Create: `packages/contracts/src/agent.ts`, `src/simulation.ts`
- Test: `packages/contracts/test/agent.test.ts`

**Interfaces:**
- Produces: `ScreenshotRef {uri,width,height}`, `Point {x,y}`, `Viewport`, `Control`, `PublicAgentInput`, `AgentAction`, `AgentActionEvent`, `AgentRunResult`, `UsageReport {inferenceCalls, inferenceUsd, wallClockMs}`, `BatchRequest`, `BatchResult`, and `interface SimulationAdapter { runBatch(req: BatchRequest, onEvent: (e: AgentActionEvent) => void, signal: AbortSignal): Promise<BatchResult> }`. Helper `isBehaviorallyValid(outcome: RunOutcome): boolean`.
- `AgentRunResult` refinements: `outcome === "goal"` ⇔ `goalVerified === true`; `behaviorallyValid === isBehaviorallyValid(outcome)`; events have `runId` equal to the run's and seq values unique. `PublicAgentInput` is `.strict()`.

- [ ] **Step 1: Write failing tests** (build a valid run via a local `makeRun(overrides)` helper in the test file)

```ts
it("rejects self-reported goal without checker verification", () => {
  expect(AgentRunResult.safeParse(makeRun({ outcome: "goal", goalVerified: false })).success).toBe(false);
});
it("rejects verified goal with non-goal outcome", () => {
  expect(AgentRunResult.safeParse(makeRun({ outcome: "agent_stop", goalVerified: true })).success).toBe(false);
});
it("requires behaviorallyValid to match outcome", () => {
  expect(AgentRunResult.safeParse(makeRun({ outcome: "model_error", goalVerified: false, behaviorallyValid: true })).success).toBe(false);
});
it("public agent input refuses hidden fields", () => {
  expect(PublicAgentInput.safeParse({ ...validInput, hiddenGoalRef: "x" }).success).toBe(false);
  expect(PublicAgentInput.safeParse({ ...validInput, allowedPaths: ["plan"] }).success).toBe(false);
});
it("event pointer is optional, never defaulted", () => {
  const e = AgentActionEvent.parse(eventWithoutPointer);
  expect(e.pointer).toBeUndefined();
});
```

- [ ] **Step 2:** FAIL. **Step 3:** Implement; export from index. **Step 4:** `npm run check -w @ghostloop/contracts` → PASS.
- [ ] **Step 5: Commit** `feat(contracts): agent and simulation schemas`.

### Task 4: Analysis, candidate, evaluation, experiment, commands

**Files:**
- Create: `packages/contracts/src/analysis.ts`, `src/candidate.ts`, `src/evaluation.ts`, `src/experiment.ts`, `src/commands.ts`; finalize `src/index.ts`
- Test: `packages/contracts/test/analysis.test.ts`, `test/commands.test.ts`

**Interfaces:**
- `analysis.ts`: `TraceRef {runId, seq?}`, `ObservationTrend` (spec fields **plus** `experimentId`), `Hypothesis` (`label: z.literal("hypothesis")`), `PatchValue` discriminated by `op` (`set_label`/`set_style_token` → string, `set_order` → int ≥ 0, `set_visibility` → boolean), `MutationPatch` (spec fields **plus** `experimentId`, `round`), `RawFeedbackProposal` — what Claude returns: `{ hypotheses: {statement, observationIds, confidence?}[], patches: {targetElementId, op, value, observationIds, rationale, modelRisk?}[] }` (no IDs, no sourceVersionId, no risk), `DesignFeedbackPacket`, `AnalysisInput { experimentId, versionId, task, intentConstraints, protectedConstraints: string[], observations: ObservationTrend[], editableElements: ManifestElement[] }`, `interface AnalysisAdapter { proposeFeedback(input: AnalysisInput): Promise<{ raw: unknown; usage: UsageReport }> }`.
- `candidate.ts`: `FigmaReference {frameUrl, status, manifestHash, patchIds}`, `DesignVersion {schemaVersion, id, parentVersionId: VersionId | null, patchIds, url, manifestHash, createdAt}`, `CandidateDesign`, `ValidationCheck {name, kind: CheckKind, passed, detail?}`, `ValidationResult`, `interface CandidateAdapter { createCandidate(sourceVersionId, approvedPatches: MutationPatch[]): Promise<CandidateDesign>; validateCandidate(candidateId): Promise<ValidationResult>; getManifest(versionId): Promise<DesignManifest> }`.
- `evaluation.ts`: `OutcomeCounts` (record of all 7 outcomes → int), `ScenarioMetrics`, `RunMetrics` (`completionRate: number | null`, `medianActionsToSuccess: number | null`), `GuardrailResult {name, passed, detail?}`, `Evaluation` (`candidate: RunMetrics | null` for guardrail rejections; `deltaPp: number | null`).
- `experiment.ts`: `StateTransition {from, to, at, note?}`, `RoundState {index, baselineBatchId?, packetId?, approvalId?, candidateId?, candidateBatchId?, evaluationId?, analysisAttempts}`, `StoppingRecord {reason, at, bestVersionId, attemptedCandidateIds, evaluationIds, rejectedPatchIds, remainingObservationIds}`, `BatchRecord {batchId, experimentId, versionId, phase: "baseline"|"candidate", round, plannedRuns, cancelled, usage, superseded: boolean}`, `Experiment {schemaVersion, id, protocol, state, incumbentVersionId, round: RoundState, transitions, usage, startedAt?, cancelRequested, stopping?}`, `Approval {schemaVersion, id, experimentId, round, sourceVersionId, patchIds, approvedBy, at}`.
- `commands.ts`: payload schemas `CreateExperiment {protocol: ExperimentProtocolDraft}`, `StartExperiment`, `CancelExperiment`, `SetObservationDisposition`, `ApprovePatches {experimentId, sourceVersionId, round, patchIds (min 0), approvedBy}`, `RecordFinalReview {experimentId, candidateId, status, note?}` (status excludes `pending`); `CommandErrorCode` enum per spec §4.6; `type CommandResult<T> = { ok: true; value: T } | { ok: false; code: CommandErrorCode; message: string }`.

- [ ] **Step 1: Write failing tests**

```ts
it("patch value type follows op", () => {
  expect(MutationPatch.safeParse({ ...basePatch, op: "set_order", value: "first" }).success).toBe(false);
  expect(MutationPatch.safeParse({ ...basePatch, op: "set_visibility", value: false }).success).toBe(true);
});
it("raw proposal cannot carry ids, source version or risk", () => {
  const r = RawFeedbackProposal.strict().safeParse({ hypotheses: [], patches: [{ ...rawPatch, risk: "low" }] });
  expect(r.success).toBe(false);
});
it("hypothesis must be labeled", () => {
  expect(Hypothesis.safeParse({ ...hyp, label: "fact" }).success).toBe(false);
});
it("final review cannot set pending", () => {
  expect(RecordFinalReview.safeParse({ experimentId: "exp_1", candidateId: "cand_1", status: "pending" }).success).toBe(false);
});
it("metrics allow null rate", () => {
  expect(RunMetrics.shape.completionRate.safeParse(null).success).toBe(true);
});
```

(`RawFeedbackProposal`'s nested patch object must be `.strict()` so the extra `risk` key fails.)

- [ ] **Step 2:** FAIL. **Step 3:** Implement and export all from `index.ts` (not `hidden.ts`). **Step 4:** `npm run check -w @ghostloop/contracts` → PASS.
- [ ] **Step 5: Commit** `feat(contracts): analysis, candidate, evaluation, experiment, commands`.

### Task 5: Fixtures, fixture loader, README; open PR 1

**Files:**
- Create: `packages/contracts/fixtures/index.ts`, `fixtures/README.md`, all JSON from spec §4.7 (plus `manifest.base.json`)
- Create: `packages/contracts/README.md`
- Test: `packages/contracts/test/fixtures.test.ts`

**Interfaces:**
- Produces: `loadFixture<T>(relPath: string, schema: z.ZodType<T>): T` and `FIXTURE_SCHEMAS: Record<string, z.ZodTypeAny>` (relative path → schema) in `fixtures/index.ts`, resolving paths via `import.meta.url`.
- Fixture element IDs (placeholders, C owns final IDs): `signup.email`, `signup.password`, `signup.consent`, `signup.submit` (categories `signup`/`consent`/`auth`, protected), `workspace.name`, `workspace.submit`, `plan.free.cta`, `plan.pro.cta`, `plan.free.price`, `plan.pro.price` (prices: protected, `pricing`), `plan.compare.link` (optional, `set_visibility`), `invite.email` (protected, `validation`), `invite.submit`, `done.heading`. Approved style tokens: `button.primary`, `button.secondary`, `emphasis.strong`.
- Batch fixtures are `BatchResult` JSON; `batch.metrics-4-4-2-1.json` has 11 runs across the 4 scenarios with `plannedRuns: 12`.
- Comparison fixtures needed by later tasks: baseline 6/12 goals (rate 0.5); `candidate-improved` 9/12 (0.75); `candidate-flat` 7/12 (~0.583); `zero-valid` 12 infra errors; `underfilled` 6 valid of 12 planned. Include at least one run that revisits `plan` (backtracking) in baseline (5 of the 12), and one `validation_error` on `invite.email`.

- [ ] **Step 1: Write failing test**

```ts
import { FIXTURE_SCHEMAS, loadFixture } from "../fixtures";
import { readdirSync } from "node:fs";

it.each(Object.entries(FIXTURE_SCHEMAS))("%s parses", (path, schema) => {
  const f = loadFixture(path, schema) as { provenance?: string };
  expect(f).toBeTruthy();
});
it("every json file is registered", () => {
  const files = walkJson(new URL("../fixtures/", import.meta.url)); // small helper in test
  expect(files.sort()).toEqual(Object.keys(FIXTURE_SCHEMAS).sort());
});
it("every fixture is labeled synthetic", () => {
  for (const p of Object.keys(FIXTURE_SCHEMAS)) expect(rawJson(p).provenance).toBe("synthetic-fixture");
});
```

Schemas must accept a top-level `provenance` field — add `provenance: z.literal("synthetic-fixture").optional()` via a wrapper in `FIXTURE_SCHEMAS` (`schema.and(z.object({provenance: ...}))`) rather than polluting entity schemas.

- [ ] **Step 2:** FAIL. **Step 3:** Write loader, fixtures, `fixtures/README.md` (what each fixture demonstrates, placeholder-ID note). **Step 4:** `npm run check -w @ghostloop/contracts` → PASS.
- [ ] **Step 5: Write `packages/contracts/README.md`:** setup (`nvm use && npm ci`), commands (`npm run check -w @ghostloop/contracts`), how to import (`@ghostloop/contracts`, `@ghostloop/contracts/hidden` for the trusted checker only, `@ghostloop/contracts/fixtures`), adapter signatures for B/C, command shapes for A, integration checklist per teammate, schema-change process (D updates contracts + fixtures first).
- [ ] **Step 6: Commit** `feat(contracts): fixtures and README`.
- [ ] **Step 7: Open PR 1.** `git branch feat/optimizer-contracts && git push -u origin feat/optimizer-contracts`; `gh pr create --base main --head feat/optimizer-contracts` titled `[MVP D] Workspace skeleton + shared contracts and fixtures`, body: what works, contracts introduced, setup, checks run (paste `npm run check` output summary), remaining work, `Refs #4`. **Ask the user before pushing/creating the PR.**

---

## PR 2 — Optimizer worker (branch `feature/MVP-D-Coordinator`)

### Task 6: Optimizer package + `computeMetrics`

**Files:**
- Create: `workers/optimizer/package.json`, `tsconfig.json`, `src/evaluator.ts`
- Test: `workers/optimizer/test/metrics.test.ts`

**Interfaces:**
- Consumes: contracts `AgentRunResult`, `RunMetrics`, `EvaluationPolicy`, `Scenario`, fixtures loader.
- Produces: `computeMetrics(input: { versionId: string; batchId: string; runs: AgentRunResult[]; plannedRuns: number; scenarios: Scenario[]; policy: EvaluationPolicy }): RunMetrics`; `dedupeEvents(events: AgentActionEvent[]): AgentActionEvent[]` (unique by `(runId, seq)`, first wins, sorted by seq).
- Package: name `@ghostloop/optimizer`, deps `@ghostloop/contracts: "*"`, `zod`; devDeps as contracts plus `tsx`; scripts `check`, `test`, `"demo:mock": "tsx src/cli/demo-mock.ts"`.

Rules (spec §5.2): dedupe runs by `runId`; `stepCount` for median = count of deduped events excluding `stop` actions; backtrack = run whose deduped event sequence has a `screenBefore` equal to a screen it previously left; `complete` = `validRuns ≥ ceil(minValidFraction × plannedRuns)` and every scenario has `≥ minValidPerScenario` valid runs; `incompleteReason` names which part failed. Per-scenario metrics use the scenario's `runs` as `plannedRuns`.

- [ ] **Step 1: Write failing tests**

```ts
it("4 goal / 4 behavioral / 2 infra / 1 cancel → 4/8", () => {
  const b = loadFixture("batch.metrics-4-4-2-1.json", BatchResult);
  const m = computeMetrics({ versionId: b.versionId, batchId: b.batchId, runs: b.runs, plannedRuns: b.plannedRuns, scenarios, policy });
  expect(m.successes).toBe(4); expect(m.validRuns).toBe(8);
  expect(m.completionRate).toBe(0.5);
  expect(m.infraErrors).toBe(2); expect(m.cancelled).toBe(1);
});
it("duplicate runs and events do not change metrics", () => {
  const dup = [...b.runs, b.runs[0]!].map((r, i) => i === 0 ? { ...r, events: [...r.events, ...r.events] } : r);
  expect(computeMetrics({ ...args, runs: dup })).toEqual(computeMetrics(args));
});
it("zero valid runs → null rate, not 0", () => {
  const m = computeMetrics(argsFor("batch.zero-valid.json"));
  expect(m.completionRate).toBeNull(); expect(m.complete).toBe(false);
});
it("underfilled batch is incomplete", () => {
  expect(computeMetrics(argsFor("batch.underfilled.json")).complete).toBe(false);
});
it("median of even count averages middles", () => {
  // two goal runs with 4 and 6 counted steps
  expect(computeMetrics(argsWithGoalSteps([4, 6])).medianActionsToSuccess).toBe(5);
});
it("no successes → null median", () => {
  expect(computeMetrics(argsFor("batch.zero-valid.json")).medianActionsToSuccess).toBeNull();
});
```

- [ ] **Step 2:** `npm install` then `npm test -w @ghostloop/optimizer` → FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(optimizer): deterministic run metrics`.

### Task 7: `compare` and stopping reason

**Files:**
- Modify: `workers/optimizer/src/evaluator.ts`
- Test: `workers/optimizer/test/compare.test.ts`

**Interfaces:**
- Produces: `compare(baseline: RunMetrics, candidate: RunMetrics | null, guardrails: GuardrailResult[], policy: EvaluationPolicy): { decision: EvaluationDecision; deltaPp: number | null; reasons: string[] }` following spec §5.2 steps 1–7 in order (validation-error rate = `validationErrorRuns / validRuns`); `stoppingReasonFor(decision, candidateRate: number | null, policy, round: number, maxIterations: number): StoppingReason | null` (`null` = park in `accepted`).
- `deltaPp` rounded to 1 decimal.

- [ ] **Step 1: Write failing tests** (use `metricsFrom(fixtureName)` helper built on `computeMetrics`)

```ts
it("failed guardrail rejects regardless of rate", () => {
  expect(compare(base, improved, [{ name: "protected", passed: false }], policy).decision).toBe("rejected");
});
it("+25pp accepts", () => {
  const r = compare(base, improved, [], policy);
  expect(r.decision).toBe("accepted"); expect(r.deltaPp).toBe(25);
});
it("+8.3pp is inconclusive", () => {
  expect(compare(base, flat, [], policy).decision).toBe("inconclusive");
});
it("zero-valid or underfilled candidate is inconclusive", () => {
  expect(compare(base, zeroValid, [], policy).decision).toBe("inconclusive");
  expect(compare(base, underfilled, [], policy).decision).toBe("inconclusive");
});
it("secondary regression rejects even with rate gain", () => {
  expect(compare(base, { ...improved, medianActionsToSuccess: base.medianActionsToSuccess! + 3 }, [], policy).decision).toBe("rejected");
});
it("large drop rejects", () => {
  expect(compare(improved, base, [], policy).decision).toBe("rejected");
});
it("stopping reasons", () => {
  expect(stoppingReasonFor("accepted", 0.9, { ...policy, targetCompletionRate: 0.8 }, 1, 3)).toBe("TARGET_MET");
  expect(stoppingReasonFor("accepted", 0.75, { ...policy, targetCompletionRate: 0.8 }, 3, 3)).toBe("ITERATION_BUDGET");
  expect(stoppingReasonFor("accepted", 0.75, { ...policy, targetCompletionRate: 0.8 }, 1, 3)).toBeNull();
  expect(stoppingReasonFor("rejected", 0.4, policy, 1, 3)).toBe("NO_MEASURED_IMPROVEMENT");
  expect(stoppingReasonFor("inconclusive", null, policy, 1, 3)).toBe("INCONCLUSIVE");
});
```

Also add to `metrics.test.ts` (Review Focus 1):

```ts
it("out-of-order duplicate events dedupe and sort", () => {
  const ev = dedupeEvents([e(3), e(2), e(2), e(0), e(1)]);
  expect(ev.map(x => x.seq)).toEqual([0, 1, 2, 3]);
});
```

- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(optimizer): candidate comparison and stopping reasons`.

### Task 8: Observations and mutation policy

**Files:**
- Create: `workers/optimizer/src/observations.ts`, `src/policy.ts`
- Test: `workers/optimizer/test/observations.test.ts`, `test/policy.test.ts`

**Interfaces:**
- Produces:
  - `aggregateObservations(input: { experimentId; versionId; batchId; runs: AgentRunResult[]; dispositions: Map<string, ObservationDisposition> }): ObservationTrend[]` — kinds per spec §5.3; `fingerprint = [kind, ...screens.sort(), ...elementIds.sort()].join("|")`; `disposition` taken from the map (default `unreviewed`). Screen-revisit statement format: `` `${n} of ${d} runs revisited ${screen}` ``. Denominator for behavioral kinds = valid runs; the `outcome_count` observation uses all runs and states infra/cancel separately.
  - `isSuppressed(o: ObservationTrend): boolean` (`intentional` | `not_relevant`).
  - `classifyPatch(p: Pick<MutationPatch, "targetElementId" | "op" | "value">, protocol: ExperimentProtocol, manifest: DesignManifest): { risk: RiskClass; blockReason?: string }` — order per spec §5.4 (unknown → protected/category → unsupported op → style token allowlist → review_required).
  - `validatePacket(raw: unknown, ctx: { experimentId; round; incumbentVersionId; protocol; manifest; observations: ObservationTrend[]; clock: () => string }): { ok: true; packet: DesignFeedbackPacket; patches: MutationPatch[]; hypotheses: Hypothesis[] } | { ok: false; errors: string[] }` — parses `RawFeedbackProposal`; fails on unknown observation ID or element; drops patches whose cited observations are all suppressed; assigns `newId` IDs, `sourceVersionId = incumbentVersionId`, `risk` via `classifyPatch`, `state = risk === "blocked" ? "blocked" : "proposed"`, `reviewPolicy` from protocol mode (`manual` → `manual_required`).

- [ ] **Step 1: Write failing tests**

```ts
// observations
it("counts plan revisits neutrally", () => {
  const obs = aggregateObservations({ ...fromFixture("batch.baseline.json"), dispositions: new Map() });
  const o = obs.find(x => x.kind === "screen_revisit" && x.screens.includes("plan"))!;
  expect(o.statement).toBe("5 of 12 runs revisited plan");
  expect(o.traceRefs.length).toBe(5);
});
it("carries prior dispositions by fingerprint", () => {
  const first = aggregateObservations({ ...args, dispositions: new Map() });
  const fp = first[0]!.fingerprint;
  const again = aggregateObservations({ ...args, dispositions: new Map([[fp, "intentional"]]) });
  expect(isSuppressed(again.find(o => o.fingerprint === fp)!)).toBe(true);
});
// policy
it.each([
  ["plan.pro.price", "set_label", "x", "blocked"],
  ["signup.consent", "set_visibility", false, "blocked"],
  ["invite.email", "set_label", "x", "blocked"],
  ["plan.free.cta", "set_order", 0, "blocked"],          // op not in supportedOps
  ["nope.element", "set_label", "x", "unknown"],
  ["plan.free.cta", "set_style_token", "button.primary", "low"],
  ["plan.free.cta", "set_style_token", "neon.glow", "review_required"],
  ["plan.free.cta", "set_label", "Continue with Free plan", "review_required"],
])("%s %s → %s", (el, op, value, risk) => {
  expect(classifyPatch({ targetElementId: el, op, value } as any, protocol, manifest).risk).toBe(risk);
});
it("model risk never lowers code risk", () => {
  const r = validatePacket({ hypotheses: [], patches: [{ ...rawLabelPatch, modelRisk: "low" }] }, ctx);
  expect(r.ok && r.patches[0]!.risk).toBe("review_required");
});
it("rejects unknown observation or element references", () => {
  expect(validatePacket({ hypotheses: [], patches: [{ ...rawLabelPatch, observationIds: ["obs_missing"] }] }, ctx).ok).toBe(false);
  expect(validatePacket({ hypotheses: [], patches: [{ ...rawLabelPatch, targetElementId: "ghost.el" }] }, ctx).ok).toBe(false);
});
it("blocked patches are kept but marked", () => {
  const r = validatePacket({ hypotheses: [], patches: [rawPricePatch] }, ctx);
  expect(r.ok && r.patches[0]!.state).toBe("blocked");
});
it("drops patches citing only suppressed findings", () => { /* ctx with suppressed observation → patches length 0 */ });
```

- [ ] **Step 2:** FAIL. **Step 3:** Implement both modules. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(optimizer): neutral observations and mutation policy`.

### Task 9: Store and command handlers

**Files:**
- Create: `workers/optimizer/src/store.ts`, `src/commands.ts`
- Test: `workers/optimizer/test/store.test.ts`, `test/commands.test.ts`

**Interfaces:**
- `store.ts` — `interface ExperimentStore` (all methods `async`):
  `getExperiment(id) → Experiment | undefined`, `putExperiment(e)`, `insertVersion(v: DesignVersion)` (throws if id exists), `getVersion(id)`, `putBatch(b: BatchRecord)`, `getBatch(id)`, `putRun(r: AgentRunResult)` (stores run without relying on its `events`; idempotent by runId), `listRuns(batchId)` (runs with `events` replaced by `listActions(runId)`), `insertAction(e: AgentActionEvent) → boolean` (false on duplicate `(runId, seq)`), `listActions(runId)` (seq order), `putObservations(obs[])`, `listObservations(experimentId)`, `setDisposition(fingerprint, d)`, `getDispositions() → Map`, `putPatches(p[])`, `listPatches(experimentId, round)`, `getPatch(id)`, `updatePatch(id, changes: Partial<MutationPatch>)`, `putHypotheses(h[])`, `putPacket(p)`, `putApproval(a)`, `getApproval(experimentId, round)`, `putCandidate(c)`, `getCandidate(id)`, `listCandidates(experimentId)`, `putEvaluation(e)`, `getEvaluation(id)`, `listEvaluations(experimentId)`, `onChange(fn: (table: string, key: string) => void) → () => void`.
  `class InMemoryStore implements ExperimentStore`; returns `structuredClone`d values.
- `commands.ts` — `createCommands(store: ExperimentStore, runtime: { launch(experimentId: string): void; cancel(experimentId: string): void }, clock: () => string)` returning `{ createExperiment, startExperiment, cancelExperiment, setObservationDisposition, approvePatches, recordFinalReview }`, each `(payload) => Promise<CommandResult<...>>` and each zod-parsing its payload first (`VALIDATION_FAILED` on parse failure).
  - `createExperiment`: freezes protocol (`id: newId("proto")`, `frozenAt`), inserts base `DesignVersion` if absent, experiment `state "created"`, `round {index: 1, analysisAttempts: 0}` → value `{ experimentId }`.
  - `startExperiment`: only from `created`; sets `startedAt`; `runtime.launch`.
  - `cancelExperiment`: non-terminal only; sets `cancelRequested`; `runtime.cancel`; `runtime.launch` (driver records the stop). From `awaiting_approval`/`accepted` (parked) this is how the stop gets written.
  - `approvePatches`: checks in order → `NOT_FOUND`, `INVALID_STATE` (state ≠ `awaiting_approval` or `cancelRequested`), `STALE_SOURCE_VERSION` (≠ incumbent), round mismatch → `STALE_SOURCE_VERSION`, existing approval → `ALREADY_APPROVED`, any ID not in `listPatches(exp, round)` → `UNKNOWN_PATCH`, any blocked → `PATCH_BLOCKED`. On success: store `Approval`, set selected patches `approved` and the rest of the round's non-blocked patches `declined`, set `round.approvalId`, `runtime.launch`.
  - `recordFinalReview`: candidate must belong to experiment; already non-`pending` → `ALREADY_APPROVED`; `promoted_measured` requires its evaluation decision `accepted` else `INVALID_STATE`; `retained_aesthetic` requires no failed guardrail; `promoted_measured` sets `incumbentVersionId = candidate.versionId`.
  - `setObservationDisposition`: observation must exist; writes `setDisposition(fingerprint, d)` and updates the observation.

- [ ] **Step 1: Write failing tests**

```ts
// store
it("dedupes actions by run+seq", async () => {
  expect(await s.insertAction(e(0))).toBe(true);
  expect(await s.insertAction(e(0))).toBe(false);
  expect((await s.listActions("run_a")).length).toBe(1);
});
it("versions are immutable", async () => {
  await s.insertVersion(v); await expect(s.insertVersion(v)).rejects.toThrow();
});
// commands (setup helper parks an experiment in awaiting_approval with patches pat_a, pat_b, pat_blocked)
it("approves only selected patches", async () => {
  const r = await cmd.approvePatches({ experimentId, sourceVersionId: base, round: 1, patchIds: ["pat_a"], approvedBy: "designer" });
  expect(r.ok).toBe(true);
  expect((await store.getPatch("pat_a"))!.state).toBe("approved");
  expect((await store.getPatch("pat_b"))!.state).toBe("declined");
  expect(runtime.launch).toHaveBeenCalledWith(experimentId);
});
it("rejects stale source version", async () => {
  expect(await cmd.approvePatches({ ...ok, sourceVersionId: "ver_other" })).toMatchObject({ ok: false, code: "STALE_SOURCE_VERSION" });
});
it("rejects second approval", async () => {
  await cmd.approvePatches(ok);
  expect(await cmd.approvePatches(ok)).toMatchObject({ ok: false, code: "ALREADY_APPROVED" });
});
it("rejects patch from another round or experiment", async () => {   // Review Focus 4
  expect(await cmd.approvePatches({ ...ok, patchIds: ["pat_from_other_exp"] })).toMatchObject({ ok: false, code: "UNKNOWN_PATCH" });
  expect(await store.getApproval(experimentId, 1)).toBeUndefined();
});
it("rejects blocked patch", async () => {
  expect(await cmd.approvePatches({ ...ok, patchIds: ["pat_blocked"] })).toMatchObject({ ok: false, code: "PATCH_BLOCKED" });
});
it("promotion requires accepted evaluation", async () => {
  expect(await cmd.recordFinalReview({ experimentId, candidateId: inconclusiveCand, status: "promoted_measured" })).toMatchObject({ ok: false, code: "INVALID_STATE" });
  await cmd.recordFinalReview({ experimentId, candidateId: acceptedCand, status: "promoted_measured" });
  expect((await store.getExperiment(experimentId))!.incumbentVersionId).toBe(acceptedCandVersion);
});
it("aesthetic retention leaves incumbent", async () => { /* status retained_aesthetic → incumbent unchanged */ });
```

- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(optimizer): in-memory store and designer commands`.

### Task 10: Mock adapters and controller round

**Files:**
- Create: `workers/optimizer/src/mocks/simulation.ts`, `mocks/analysis.ts`, `mocks/candidates.ts`, `src/controller.ts`
- Test: `workers/optimizer/test/controller.test.ts`

**Interfaces:**
- Mocks:
  - `createMockSimulation(plan: { baseline: string; candidate: string; delayMs?: number; throwOn?: "baseline" | "candidate" }): SimulationAdapter & { calls: BatchRequest[] }` — loads the named batch fixture, rewrites `batchId`/`versionId`/run IDs to the request's (fresh `newId("run")` per run), emits each event via `onEvent` (deliberately emitting one duplicate), honors `signal` (on abort: resolves with runs so far and `cancelled: true`).
  - `createMockAnalysis(responses: unknown[] | ((input: AnalysisInput) => unknown), usd = 0.05): AnalysisAdapter & { calls: AnalysisInput[] }` — default response builds a valid `RawFeedbackProposal` citing the plan-revisit observation from `input.observations` with patches: label on `plan.free.cta`, style token `button.primary` on `plan.free.cta`, label on `plan.pro.price` (will be blocked).
  - `createMockCandidates(opts?: { validation?: "pass" | "fail_runnable" | "fail_guardrail"; throwOn?: "create" | "validate" }): CandidateAdapter & { created: { sourceVersionId: string; patchIds: string[] }[] }` — `getManifest` returns `manifest.base.json` with `versionId` rewritten; `createCandidate` returns a new `ver_`/`cand_` pair.
- `controller.ts`:
  - `type ControllerDeps = { store: ExperimentStore; simulation: SimulationAdapter; analysis: AnalysisAdapter; candidates: CandidateAdapter; clock: () => string; now: () => number }`.
  - `step(experimentId: string, deps: ControllerDeps, signal: AbortSignal): Promise<Experiment>` — one state's work + transition (`transitions.push({from,to,at})`).
  - `class ExperimentRuntime { constructor(deps: ControllerDeps); launch(id): void; cancel(id): void; drive(id): Promise<Experiment>; idle(id): Promise<void> }` — `launch` starts `drive` unless one is already running for that id (re-runs once more after it finishes if relaunched meanwhile); `cancel` aborts that experiment's `AbortController`; `drive` loops `step` until state is `awaiting_approval` without `round.approvalId`, `accepted` with no stopping record, or `stopped`; `idle` resolves when the current drive finishes (for tests/CLI).
- Step semantics (spec §5.6): before every step, if `cancelRequested` → stop `USER_STOP`; then budgets: `usage.inferenceUsd ≥ maxInferenceUsd` → `COST_BUDGET`, `now() − startedAt ≥ maxWallClockMs` → `TIME_BUDGET`, candidates in experiment ≥ `maxCandidates` before patching → `ITERATION_BUDGET`. Terminal-decision states (`accepted`/`rejected`/`inconclusive`) move to `stopped` when a stopping reason applies. Entering `baseline_running`/`candidate_running` with an existing batch for that phase marks it `superseded` and runs a new one. Events from `onEvent` go to `store.insertAction`; runs to `putRun`. `diagnosing` builds observations; `proposing` calls analysis with non-suppressed observations and non-protected manifest elements, validates with `validatePacket`; invalid → retry once (`analysisAttempts`), then `NO_VALID_PATCH`; zero non-blocked patches → `NO_VALID_PATCH`. `awaiting_approval` with approval of zero patches → `NO_VALID_PATCH`. `patching` passes only `approved` patches to `createCandidate(incumbentVersionId, ...)`, inserts the `DesignVersion`, marks patches `applied`. `validating` per spec (runnable fail → `INTEGRATION_FAILURE`; guardrail fail → rejected Evaluation + `NO_VALID_PATCH`). `comparing` writes the Evaluation with `compare` + `stoppingReasonFor`. Any adapter throw → `INTEGRATION_FAILURE`. Stopping record fields per spec (`bestVersionId` = incumbent).

- [ ] **Step 1: Write failing tests** (helper `setup(opts)` builds store, mocks, runtime, commands, creates + starts experiment from `protocol.default.json`, returns handles)

```ts
it("parks at approval without creating a candidate", async () => {
  const t = await setup(); await t.runtime.idle(t.id);
  expect((await t.exp()).state).toBe("awaiting_approval");
  expect(t.candidates.created).toHaveLength(0);
});
it("full round: partial approval → candidate with only selected patches → accepted", async () => {
  const t = await setup({ candidate: "batch.candidate-improved.json" }); await t.runtime.idle(t.id);
  const [label] = await t.proposedPatches();
  await t.cmd.approvePatches({ experimentId: t.id, sourceVersionId: t.base, round: 1, patchIds: [label.id], approvedBy: "d" });
  await t.runtime.idle(t.id);
  expect(t.candidates.created[0]).toEqual({ sourceVersionId: t.base, patchIds: [label.id] });
  const e = await t.exp();
  expect(e.transitions.map(x => x.to)).toEqual(["baseline_running","observing","diagnosing","proposing","awaiting_approval","patching","validating","candidate_running","comparing","accepted"]);
  expect(e.incumbentVersionId).toBe(t.base);                 // promotion waits for final review
  const sims = t.simulation.calls;
  expect(sims[0]!.batchId).not.toBe(sims[1]!.batchId);       // fresh retest
  expect(sims[0]!.maxActionsPerRun).toBe(sims[1]!.maxActionsPerRun);
});
it("flat candidate → inconclusive, stopped, incumbent preserved", async () => { /* expect stopping.reason "INCONCLUSIVE", incumbent base, base version still in store */ });
it("guardrail failure → rejected, NO_VALID_PATCH, no retest", async () => { /* validation: fail_guardrail; simulation.calls length 1 */ });
it("runnable failure → INTEGRATION_FAILURE", async () => { /* validation: fail_runnable */ });
it("adapter throw → INTEGRATION_FAILURE", async () => { /* throwOn: "create" */ });
it("cancel mid-baseline → USER_STOP, no further adapter calls", async () => {
  const t = await setup({ delayMs: 50 }); await t.cmd.cancelExperiment({ experimentId: t.id });
  await t.runtime.idle(t.id);
  const e = await t.exp();
  expect(e.state).toBe("stopped"); expect(e.stopping!.reason).toBe("USER_STOP");
  expect(t.analysis.calls).toHaveLength(0);
});
it("cancel while awaiting approval; later approval refused", async () => {   // Review Focus 3
  const t = await setup(); await t.runtime.idle(t.id);
  await t.cmd.cancelExperiment({ experimentId: t.id }); await t.runtime.idle(t.id);
  expect((await t.exp()).stopping!.reason).toBe("USER_STOP");
  expect(await t.cmd.approvePatches(t.okApproval())).toMatchObject({ ok: false, code: "INVALID_STATE" });
  expect(t.candidates.created).toHaveLength(0);
});
it("cost budget stops before proposing", async () => { /* maxInferenceUsd 0.01, analysis usd 0.05 → after first analysis, COST_BUDGET; or baseline usage over budget */ });
it("invalid packet twice → NO_VALID_PATCH", async () => { /* analysis responses: [{bad:1},{bad:2}] */ });
it("resume after restart re-runs baseline and ignores partial batch", async () => {   // Review Focus 2
  // store an experiment in baseline_running with a superseded-to-be partial batch (3 runs), new runtime drives it
  // expect a new baseline batch id, old batch superseded: true, observations' denominators = 12
});
it("duplicate emitted events stored once", async () => { /* listActions for a run has unique seqs */ });
```

- [ ] **Step 2:** FAIL. **Step 3:** Implement mocks and controller. **Step 4:** `npm run check -w @ghostloop/optimizer` → PASS.
- [ ] **Step 5: Commit** `feat(optimizer): resumable controller round on mock adapters`.

### Task 11: Mock demo CLI, README, open PR 2

**Files:**
- Create: `workers/optimizer/src/cli/demo-mock.ts`, `workers/optimizer/README.md`
- Modify: root `package.json` (add `"demo:mock": "npm run demo:mock -w @ghostloop/optimizer"`) — note in the PR that A owns root scripts.

**Interfaces:**
- Consumes: `ExperimentRuntime`, `createCommands`, `InMemoryStore`, mocks.

- [ ] **Step 1: Implement CLI.** Prints a `MOCK MODE — synthetic fixtures, not real evidence` banner; creates + starts the experiment; subscribes `store.onChange` to print state transitions; at `awaiting_approval` prints observations (statements + counts), hypotheses (labeled), patches with risk; auto-approves the first non-blocked patch via `cmd.approvePatches`; prints baseline vs candidate metrics (exact counts, infra/cancel shown separately, `n/a` for null rate), decision, reasons, stopping reason. Flag `--candidate flat|improved|zero-valid` selects the candidate fixture (default `improved`); since accepted-below-target parks, the CLI issues `cancelExperiment` afterward to show a stopping record when needed.
- [ ] **Step 2: Run** `npm run demo:mock` → output ends with decision `accepted` and transitions through `accepted`; `npm run demo:mock -- --candidate flat` → `inconclusive` / `INCONCLUSIVE`.
- [ ] **Step 3: Write README:** setup, commands (`npm run check -w @ghostloop/optimizer`, `npm run demo:mock`), env vars (none yet; `ANTHROPIC_API_KEY` reserved for the Claude slice), module map, state machine, acceptance rule, what is mocked, integration checklist (B: `runBatch`; C: `createCandidate`/`validateCandidate`/`getManifest`; A: commands + store subscription), next slices (SpacetimeDB, Claude adapter, real adapters).
- [ ] **Step 4: Verify everything** `npm run check` at root → all workspaces typecheck and pass.
- [ ] **Step 5: Commit** `feat(optimizer): mock demo CLI and README`.
- [ ] **Step 6: Open PR 2** after PR 1 merges: rebase on `main`, push, `gh pr create` titled `[MVP D] Optimizer: evaluator, policy, controller round (mock adapters)`, body per merge-plan rule 7, `Refs #4`. **Ask the user before pushing/creating the PR.** Tick the matching checkboxes on issue #4 only with the user's OK.
