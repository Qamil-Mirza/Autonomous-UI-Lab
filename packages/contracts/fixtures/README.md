# `@ghostloop/contracts` fixtures

Every file here is **synthetic** and carries `"provenance": "synthetic-fixture"`. Never present it as real
evidence (dashboards, demos, PR descriptions).

## Loading

```ts
import { FIXTURE_SCHEMAS, loadFixture } from "@ghostloop/contracts/fixtures";
import { BatchResult } from "@ghostloop/contracts";

const baseline = loadFixture("batch.baseline.json", BatchResult);
```

- `loadFixture(relPath, schema)` reads the file, checks that `provenance === "synthetic-fixture"`, strips that key,
  and parses the rest with `schema`. The value you get back is a plain entity with no `provenance` field.
- `FIXTURE_SCHEMAS` maps each relative path to its entity schema. `test/fixtures.test.ts` checks that every
  `.json` file in this folder is registered and parses.
- A JSON array cannot carry a label, so array fixtures (only `observations.json`) are stored as
  `{ "provenance": "synthetic-fixture", "items": [...] }`. When the schema is a `z.array(...)`, the loader parses `items`.

## Schema changes and regenerating

Do not hand-edit the JSON. It is all produced by the deterministic generator `scripts/generate-fixtures.mjs`:

```sh
npm run fixtures:generate -w @ghostloop/contracts   # rewrites fixtures/*.json in place
npm run check -w @ghostloop/contracts
```

When a contract changes, D updates `src/*.ts`, then the generator, then regenerates and commits the generator and
the JSON together. Running the generator on unchanged sources reproduces the committed files byte-for-byte, so
`git diff --exit-code packages/contracts/fixtures` after a run shows exactly what the change did.

## Placeholder IDs

The demo task has five screens: `signup`, `workspace`, `plan`, `invite`, `done`. The plan screen also has a
comparison view, `compare`, which opens and closes through `plan.compare.link`. C owns the final element IDs. The IDs
below are placeholders and will be renamed once C publishes its manifest:

`signup.email`, `signup.password`, `signup.consent`, `signup.submit`, `workspace.name`, `workspace.submit`,
`plan.free.cta`, `plan.pro.cta`, `plan.free.price`, `plan.pro.price`, `plan.compare.link`, `invite.email`,
`invite.submit`, `done.heading`.

Shared IDs: experiment `exp_demo0001`, protocol `proto_demo0001`, base version `ver_base0001`, candidate versions
`ver_cand0001` (improved), `ver_cand0002` (flat / Figma mismatch), `ver_cand0003` (fails validation).

## Files

| File | Schema | What it demonstrates |
| --- | --- | --- |
| `protocol.default.json` | `ExperimentProtocol` | 4 scenarios (`scn_baseline`, `scn_invalid_email`, `scn_hesitant`, `scn_fast`) × 3 runs = 12, 8 actions per run, target 0.8, policy defaults, manual mode, all six protected categories, the 3 approved style tokens |
| `manifest.base.json` | `DesignManifest` | The element catalog for `ver_base0001`. Signup, price and `invite.email` elements are protected and have categories. `plan.free.cta` and `plan.pro.cta` support `set_label` and `set_style_token`. `plan.compare.link` supports `set_visibility` and `set_label` |
| `runs/*.json` | `AgentRunResult` | One run per outcome (`goal`, `agent_stop`, `step_limit`, `flow_blocked`, `model_error`, `browser_error`, `user_cancelled`), copied from `batch.metrics-4-4-2-1.json` |
| `batch.metrics-4-4-2-1.json` | `BatchResult` | 11 runs of 12 planned: 4 goal, 4 behavioral failures, 2 infra errors, 1 cancelled, which gives 4 successes out of 8 valid runs. 8 valid runs is less than ceil(0.75 × 12) = 9, so the batch counts as **incomplete** |
| `batch.baseline.json` | `BatchResult` | 12 valid runs on `ver_base0001`, 6 of them goals (rate 0.5, median steps 7.5). 5 runs revisit `plan`, and 1 run has a `validation_error` on `invite.email` |
| `batch.candidate-improved.json` | `BatchResult` | 12 valid runs on `ver_cand0001`, 9 of them goals (rate 0.75, median steps 7): +25pp, which is accepted |
| `batch.candidate-flat.json` | `BatchResult` | 12 valid runs on `ver_cand0002`, 7 of them goals (rate 0.5833, median steps 7): +8.3pp, which is inconclusive |
| `batch.zero-valid.json` | `BatchResult` | 12 runs, all infra errors (6 model, 6 browser). The completion rate is `null` |
| `batch.underfilled.json` | `BatchResult` | 8 runs of 12 planned and only 6 valid (6 < 9). `scn_fast` has no valid run |
| `observations.json` | `ObservationTrend[]` | Baseline findings: goal count, plan revisit (5/12), stops on plan (3/12), the `invite.email` validation error (1/12), step limit (1/12), and a repeated no-effect click on `signup.submit` (1/12) |
| `feedback-packet.json` | `DesignFeedbackPacket` | 4 patches. 3 are unblocked: `pat_0001` `set_label` and `pat_0002` `set_style_token` on `plan.free.cta`, and `pat_0003` `set_visibility` on `plan.compare.link`. 1 is blocked: `pat_0004` `set_label` on `plan.pro.price` |
| `approval.partial.json` | `Approval` | Approves `pat_0001` and `pat_0002` only |
| `candidate.json` | `CandidateDesign` | `cand_0001` (`ver_cand0001`) built from the approved patches, Figma `verified` |
| `candidate.figma-mismatch.json` | `CandidateDesign` | `cand_0002` (`ver_cand0002`), Figma `mismatch` |
| `validation.pass.json` | `ValidationResult` | All runnable and guardrail checks pass for `cand_0001` |
| `validation.fail.json` | `ValidationResult` | `cand_0003` fails the `protected_elements_unchanged` guardrail |
| `evaluation.accepted.json` | `Evaluation` | Baseline vs improved: `deltaPp` 25, `accepted`. 0.75 is below the 0.8 target, so there is no stopping reason |
| `evaluation.rejected.json` | `Evaluation` | Guardrail failure: `candidate: null`, `deltaPp: null`, `rejected`, `NO_VALID_PATCH` (spec §5.6: a guardrail failure stops with `NO_VALID_PATCH`) |
| `evaluation.inconclusive.json` | `Evaluation` | Baseline vs flat: `deltaPp` 8.3 ((7/12 − 0.5) × 100 rounded to 1 decimal, as `compare()` does), `inconclusive`, `INCONCLUSIVE` |

### Batch outcome table

"Steps" means a run's events minus `stop` actions. Every run's `stepCount` equals that number.

| Batch | Runs / planned | goal | agent_stop | step_limit | flow_blocked | model_error | browser_error | cancelled | Goal steps | Plan revisits | Validation-error runs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| metrics-4-4-2-1 | 11 / 12 | 4 | 2 | 1 | 1 | 1 | 1 | 1 | 6, 7, 7, 8 | 2 | 1 |
| baseline | 12 / 12 | 6 | 3 | 1 | 2 | 0 | 0 | 0 | 6, 7, 7, 8, 8, 8 | 5 | 1 |
| candidate-improved | 12 / 12 | 9 | 1 | 1 | 1 | 0 | 0 | 0 | 6, 6, 6, 7, 7, 7, 8, 8, 8 | 2 | 1 |
| candidate-flat | 12 / 12 | 7 | 2 | 1 | 2 | 0 | 0 | 0 | 6, 6, 7, 7, 8, 8, 8 | 3 | 1 |
| zero-valid | 12 / 12 | 0 | 0 | 0 | 0 | 6 | 6 | 0 | none | 0 | 0 |
| underfilled | 8 / 12 | 3 | 1 | 1 | 1 | 1 | 1 | 0 | 6, 8, 8 | 2 | 1 |

Conventions used in every batch:
- Event `seq` starts at 0 and has no gaps.
- `click` events carry a `pointer`. `type` and `stop` events leave it out.
- Every event has a screenshot reference `{ uri: "artifacts/<runId>/<seq>.png", width: 1280, height: 800 }`.
- A plan revisit is the `plan → compare → plan` loop through `plan.compare.link`. The only other screen any run
  revisits is `compare`, in the `step_limit` run that opens the comparison twice.

## Current prototype handoff versus historical metric fixtures

`manifest.base.json` now describes the handed-off `ver_baseline` element names and
labels. `plan.free.note` is static text with `visible: false`, not a link.
`manifest.legacy.json` preserves `ver_base0001` for the older synthetic batches,
feedback packets and evaluations. Those fixtures use the old comparison screen
and optional-invite flow; they are not runnable demonstrations of the new required
invitation flow. Do not join their traces to `ver_baseline` or silently rename their
actions. Use fresh simulator traces for the current app.
