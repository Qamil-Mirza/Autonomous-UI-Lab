# GhostLoop MVP Merge Plan

**Event:** Cal Hacks 13.0  
**Source of truth:** [Product PRD](PROJECT-PRD.md), especially sections 8–15, 17, and 22.  
**Figma submission context:** [Sponsor brief and team responsibilities](FIGMA-SPONSOR-BRIEF.md). A coordinates submission assembly; all owners contribute their actual build process.

**Status:** Implementation plan; milestones below have not yet been verified.  
**Team assignments:** Unassigned. Each teammate, including the project owner, takes one workstream.

## 1. The result we are merging toward

The four workstreams must combine into one working product:

**Configure a task → run real agents on Design A → inspect evidence → propose and approve a patch → generate Design B → run fresh agents on B → compare results → accept, reject, or mark inconclusive.**

The demo task is to create an account, create exactly one workspace on the Free plan, and successfully invite one fictional teammate without starting a paid trial. The success checker verifies actual application state. Signup, pricing, authentication, required consent, invitation validation, and the checker remain protected.

The first integrated release uses one supported prototype, Manual Review, one candidate at a time, and one complete optimization round. Selecting only some proposed patches must work, and that exact selection must be retested. The original design remains available throughout.

A truthful rejection or inconclusive result is a valid product outcome. A mock-only run, fabricated improvement, or model-declared success does not satisfy the MVP.

## 2. Workstreams and file ownership

| Workstream | Issue | Difficulty | Primary ownership |
| --- | --- | --- | --- |
| A — Dashboard and designer review | [#1](https://github.com/Qamil-Mirza/Autonomous-UI-Lab/issues/1) | Medium | `apps/dashboard/**`, root workspace configuration/scripts, lockfile coordination, demo runbook |
| B — Synthetic-user simulation | [#2](https://github.com/Qamil-Mirza/Autonomous-UI-Lab/issues/2) | Hard | `workers/simulator/**`, browser execution, recorded-run artifacts |
| C — Prototype, patches, and Figma | [#3](https://github.com/Qamil-Mirza/Autonomous-UI-Lab/issues/3) | Medium | `apps/prototype/**`, `packages/design-engine/**`, `packages/prototype-adapter/**`, `designs/**`, demo Figma variants |
| D — Storage, evaluation, and optimization | [#4](https://github.com/Qamil-Mirza/Autonomous-UI-Lab/issues/4) | Hard | `packages/contracts/**`, `spacetimedb/**`, `workers/optimizer/**`, backend commands and evaluation policy |

**Difficulty scale:** Easy means a small isolated task with known inputs and outputs. Medium means several connected components with mostly deterministic behavior. Hard means model/browser orchestration, recovery, or correctness across services. Each workstream includes smaller tasks of varying difficulty.

These paths are implementation boundaries to establish, not existing packages. All four developers can work in parallel after the initial contract agreement. A teammate may help another workstream, but changes to shared files should be coordinated with their owner.

Keep exactly these four root issues. Use checklists and multiple small pull requests within them. An early scaffold PR should use `Refs #N`, not close the issue before its integration checks pass.

## 3. Working and merging rules

1. Publish this document to `main`, then start feature branches from the latest `main`. Suggested prefixes are `feat/dashboard-`, `feat/simulator-`, `feat/prototype-`, and `feat/optimizer-`.
2. Merge small usable slices throughout the hackathon. Do not wait for four completed branches before attempting integration.
3. Before a merge, incorporate the latest `main`, resolve conflicts with the affected owner, and run the checks relevant to that slice.
4. A producer and one consumer verify each shared interface together. For example, B and C verify controls and goal checking; A and D verify subscriptions and commands.
5. Keep `main` runnable at its current milestone. Incomplete features may use clearly labeled fixture adapters, but real integration gates must exercise real services.
6. A coordinates root scripts, workspace declarations, and lockfile changes. D coordinates shared schema changes and generated database bindings. Regenerate the lockfile/bindings using the agreed tools rather than hand-merging generated content.
7. Each PR states what works, affected contracts, setup changes, exact checks run, and remaining integration work. Missing credentials or a skipped live check must be reported explicitly.
8. Record the merged commit and integration evidence in the relevant root issues. Keep a known working commit for the demo. If a merge breaks the existing path, fix it immediately or revert the isolated change; preserve shared history.

## 4. Merge 0 — Workspace, contracts, and external-service checks

**Lead:** A for workspace setup; D for contracts. **Participants:** All four.  
**Unblocks:** Every later milestone.

### Deliverables

- [ ] A establishes one package manager, pinned runtime/tool versions, workspace layout, root scripts, `.gitignore`, and setup documentation. Check in example environment-variable names without secrets.
- [ ] D publishes versioned TypeScript contracts and runtime validators for protocols, scenarios, actions, run results, observations, hypotheses, patches, feedback packets, candidates, validation, and evaluations.
- [ ] D supplies contract-valid fixtures for success, behavioral failure, infrastructure failure, cancellation, approval, acceptance/rejection/inconclusive, and Figma mismatch. Label fixture provenance.
- [ ] B and C agree on stable control IDs, screen IDs, version routing, run-state isolation/reset, and the trusted goal-checker interface.
- [ ] All four agree on artifact storage and URL resolution: B produces screenshots, D persists references, and A must be able to load them. A local artifact directory/server is sufficient for the MVP.
- [ ] B verifies one real Bitdeer screenshot request; C creates an editable Figma variant or validates the supported designer-triggered fallback; D proves a SpacetimeDB write reaches a subscribed client and validates a Claude structured response.

### Contracts to freeze

| Boundary | Producer → consumer | Minimum agreement |
| --- | --- | --- |
| Browser environment | C → B | Version URL, stable controls, visible UI metadata, run initialization/reset, trusted `checkGoal(runId)` result with evidence |
| Simulation | B → D | `runBatch(request, onEvent, abortSignal)`; protocol/version/scenario/run IDs, limits, ordered events, final verified results, usage and cancellation |
| Trace display | B → D → A | Per-run sequence, before/after screen, actual pointer position when present, viewport size, screenshot reference, action result and termination reason |
| Candidate creation | C → D | `createCandidate(sourceVersionId, approvedPatches)` and `validateCandidate(candidateId)`; immutable parent/patch lineage, runnable URL and guardrail results |
| Designer commands | A → D | Create/start/cancel, observation disposition, selected patch approval with source version, final review |
| Live state | D → A | Generated subscription bindings, snapshot/update lifecycle, review state, metrics, stopping reason and version history |
| Figma review | C → D → A | Frame URL, design version, manifest identity, patch IDs, verified/pending/mismatch status |

The adapter names above describe intended boundaries. D records precise types and async/error behavior in `packages/contracts` with the producing owners. Do not create separate incompatible versions of the same types.

Keep the hidden checker and correct navigation path out of model-facing observations. Freeze the scenario allocation, action limits, completion target, improvement margin, regression limits, and batch-completeness rule before baseline execution. Benchmark the illustrative 12-run/8-action defaults: a multi-field onboarding task may need more than eight actions.

### Gate to pass

Each owner can import the shared contracts, run their initial package or fixture adapter, and explain the input/output of their first handoff. Record external-service check results and any remaining access blocker. A failed external check does not stop unrelated fixture work, but it cannot count as a passed live gate.

## 5. Parallel development after Merge 0

| Owner | Build independently | First integration partner |
| --- | --- | --- |
| A | Dashboard configuration, trace replay, review and comparison using shared fixtures | D for live commands/subscriptions |
| B | One model-driven run against a small test site, then a bounded batch runner | C for the actual onboarding app |
| C | Onboarding app, state checker, hardcoded safe patch, immutable A/B versions, editable Figma variant | B for controls/checker; D for candidate creation |
| D | One controller round using mock simulation/candidate adapters; storage and deterministic evaluation | B and C for the real closed loop |

Merge these foundations as they become usable. Dashboard and Figma development should begin early even though their final integration gates come later. The milestone order below describes when behavior is verified, not when teammates may begin coding.

## 6. Merge 1 — Real agent execution on the prototype

**Lead:** B and C. **Consumer:** D; A can begin consuming recorded traces.  
**Requires:** Merge 0 contracts and C's runnable baseline.

### Merge sequence

1. C merges the five-screen onboarding app, stable controls, isolated run state, and trusted goal checker.
2. B connects the observation/action loop to that app and emits contract-valid ordered traces.
3. B and D connect event ingestion; provide real trace artifacts to A for replay.

### Gate to pass

- [ ] A real Bitdeer-driven agent performs at least two actual browser actions against the correct design version.
- [ ] The invalid-email scenario encounters validation feedback and can attempt recovery.
- [ ] Goal status comes from C's state checker, not model text or a success heading.
- [ ] Run outcomes distinguish goal, explicit stop, step limit, blocked product flow, model error, browser error, and cancellation.
- [ ] Two isolated runs do not share workspace/account state; cancellation releases browser contexts and retains partial evidence.
- [ ] Ordered actions, screenshot references, screen/version IDs, and final outcome can be read by another teammate.

**Evidence:** Save a real run ID, its trace/artifact location, tested commit, scenario, and reproducible command. A run need not succeed to prove execution; keep working toward genuine successful and non-successful replay examples.

## 7. Merge 2 — One real optimization round

**Lead:** D. **Participants:** B and C.  
**Requires:** Merge 1 and C's patch/validation adapter.

### Merge sequence

1. C merges deterministic allowed patches, immutable candidate creation, protected-function checks, and runnable version URLs.
2. D replaces mocked simulation and candidate adapters with B/C implementations.
3. Run a baseline, aggregate trace-grounded observations, and obtain a structured proposal from Claude.
4. Approve a specific patch subset through D's real command interface, generate the candidate, validate it, run fresh sessions, and compare.

Until the dashboard is connected, an explicit developer command can submit the approval. It must call the same persisted approval path the dashboard will use; it must not bypass permission checks.

### Gate to pass

- [ ] Claude's proposal cites existing observations and supported element IDs; measured observations and hypotheses remain separate.
- [ ] Required approval precedes mutation, and only approved patch IDs from the correct source version are applied.
- [ ] Blocked mutations fail deterministically; invalid candidates do not proceed to evaluation.
- [ ] Baseline and candidate share the frozen protocol but use fresh browser/app sessions and distinct run IDs.
- [ ] D computes acceptance independently from verified run results and guardrails; Claude cannot declare success.
- [ ] A fixture with 4 goals, 4 behavioral failures, 2 infrastructure failures, and 1 cancellation reports **4/8 = 50%**, with exclusions shown separately.
- [ ] Zero valid runs and incomplete incomparable batches cannot produce a winning candidate; rejection/inconclusive preserves the incumbent.
- [ ] Cancellation, exhausted budgets, and candidate/integration failures stop further work and record the correct reason.

**Evidence:** Record baseline/candidate version IDs, experiment/protocol ID, selected patches, approval record, both run batches, validation results, evaluation, and stopping reason. Preserve Design A and the rejected or accepted candidate history.

## 8. Merge 3 — Dashboard controls the real loop

**Lead:** A and D. **Support:** B for trace data; C for previews.  
**Requires:** Merge 2 and A's fixture-driven dashboard.

### Merge sequence

1. A replaces fixture commands/subscriptions with D's live adapter.
2. Connect configuration/start/cancel, observation disposition, selective patch approval, version review, and comparison.
3. Verify live visualization and recorded replay against B's actual traces and C's correct version/screen.

### Gate to pass

- [ ] A designer can complete the real configure → run → evidence → approve → candidate → retest → comparison path from the UI.
- [ ] Initial subscription snapshots and reconnects preserve a consistent display; duplicate or reordered action events replay once in sequence.
- [ ] Cursors/terminal markers use recorded coordinates and correct viewport scaling; missing coordinates do not create invented positions.
- [ ] Version/screen changes do not mix incompatible coordinates or screenshots.
- [ ] Counts, exclusions, hypotheses, guardrails, and explicit stopping reasons are understandable; zero valid runs show no misleading rate.
- [ ] Marking a finding Intentional persists and prevents the same finding from repeatedly triggering a recommendation.
- [ ] Patch approval-to-test and final review/promotion are distinct. Rejected or inconclusive candidates do not silently become the measured winner.

**Evidence:** Run the dashboard browser smoke check on the integrated commit and save the associated experiment ID. Mock mode remains labeled and available for development.

## 9. Merge 4 — Editable Figma review and demo readiness

**Lead:** C for Figma correspondence; A for the demo runbook. **Participants:** All four.  
**Requires:** Merge 3. This completes the dashboard/Figma/demo milestone grouped as Merge 3 in the issues, using the PRD's finer Merge 3–4 breakdown.

### Gate to pass

- [ ] Open an editable Figma candidate linked to the actual tested React version and selected patch IDs.
- [ ] Verify changed properties against the canonical manifest. Show pending/mismatch honestly; a screenshot or an unverified frame does not count as matched editable review.
- [ ] If automated write-back is unavailable, demonstrate the supported designer-triggered editable-variant workflow and record the correspondence check.
- [ ] Offer at least two patches, select only a subset, and demonstrate that this creates and retests its own immutable candidate rather than reusing scores from the full patch set.
- [ ] A teammate other than the setup owner starts the merged application from the documented instructions.
- [ ] Rehearse the three-minute demo and save a replay of previously recorded real runs with a clear recorded label. Development fixtures must not be presented as real evidence.
- [ ] Confirm the original design, candidate history, independent comparison, designer decision, and stopping reason remain inspectable.
- [ ] A assembles the Figma submission: video at most 3 minutes, stage log at most 200 words per stage, and required Figma Slides. All owners supply actual tool choices, reasons, approximate minutes, ratings, handoffs, and friction.
- [ ] A/C verify embedded Figma Make(s) and/or prototypes, the working code/repository link, “Anyone” file access, and Edu verification. Collect final links in the demo runbook; use the [sponsor checklist](FIGMA-SPONSOR-BRIEF.md#submission-checklist).

These submission checks document how the team built GhostLoop. Editable variants and correspondence checks above remain GhostLoop product requirements; automated Figma writing is not required by the supplied sponsor brief. Runtime experiment evidence supports but does not replace the team's stage log.

**Evidence:** Add the final tested commit, experiment ID, artifact references, original/candidate URLs, Figma links, and startup/demo commands to the demo runbook. Include the fallback procedure and identify live versus recorded portions.

## 10. Checks and commands to establish

The repository currently contains documentation only. The commands below are a proposed script contract to implement, not commands that already work. At Merge 0, A records the chosen package manager and exact equivalents in the README. The examples use npm syntax.

| Command | Owner(s) | Required behavior |
| --- | --- | --- |
| `npm ci` | A | Reproducible workspace install after a lockfile exists |
| `npm run dev` | A with B/C/D | Start apps/workers for the current milestone; document separate database/bootstrap prerequisites and fail clearly on missing configuration |
| `npm run check` | A coordinates all | Typecheck and build implemented packages; validate shared fixtures; run deterministic tests for action validation, protected patches, metrics and controller transitions |
| `npm run test:integration` | B/C/D | Exercise the real baseline → approved patch → fresh retest path with bounded live-service use; report run IDs, failures, and missing credentials explicitly |
| `npm run test:e2e` | A with all | Exercise the integrated designer flow through the dashboard and verify resulting backend state |

Run checks appropriate to each merge. Once a milestone passes, later merges must preserve it. Use deterministic fixtures for error paths and metric arithmetic; use actual external-service/browser runs to prove live integration. A passing mocked check cannot substitute for the live acceptance path.

## 11. Handling handoff changes and blockers

| Situation | Next action |
| --- | --- |
| Shared schema must change | Producer and consumers agree on the change; D updates contracts/fixtures first, then update all affected adapters and bindings in the same integration slice |
| Consumer is not ready | Merge the producer with a contract-valid fixture/adapter and document the pending connection; keep the milestone open |
| Model returns an invalid action or patch | Validate/reject it, retry only within the configured budget, and persist the actual failure reason |
| Service credentials/access are unavailable | Continue independent fixture work and document the blocker in the existing root issue; do not mark a live gate complete |
| Figma and React differ | Mark the mismatch, repair the mapping/variant, and repeat correspondence verification before the Figma gate passes |
| A candidate does not improve results | Keep the incumbent and report rejection/inconclusive; never alter the goal checker or fabricate a win |
| A merge breaks the working demo | Fix or revert that isolated change, repeat the affected gate, and keep the last known working commit available |

## 12. Scope cuts and completion

If time is tight, cut arbitrary Figma imports, large persona combinations, advanced heatmap effects, concurrent candidates, then automatic multi-round optimization. Keep real browser interactions, verified outcomes, trace evidence, approved executable patches, fresh retesting, reversible history, and editable designer review.

Before closing the four issues, all owners confirm:

- [ ] Merges 0–4 have evidence recorded against the integrated commit.
- [ ] The complete designer flow works with real simulation, inference, storage, and candidate generation.
- [ ] Selective approval, protected requirements, cancellation, and failure reporting work.
- [ ] The setup instructions and demo runbook are reproducible by another teammate.
- [ ] The recorded-real-run fallback is clearly labeled and usable.

Closing an issue means its component works inside the merged product. Completing a component in isolation is an intermediate milestone.
