# @ghostloop/optimizer (workstream D)

The optimizer owns the experiment loop: observe a baseline batch, diagnose, propose patches, wait for a human
approval, build a candidate, retest, and decide with a fixed acceptance rule. This first deliverable runs the whole
round end to end on **mock adapters** and an in-memory store. All mock data is synthetic
(`provenance: "synthetic-fixture"`); never present it as real evidence.

## Setup and commands

```sh
npm install                                  # at the repo root
npm run check -w @ghostloop/optimizer        # typecheck + vitest
npm run demo:mock                            # improved candidate: accepted, then cancelled (USER_STOP)
npm run demo:mock -- --candidate flat        # inconclusive / INCONCLUSIVE
npm run demo:mock -- --candidate zero-valid  # candidate has no valid runs: inconclusive
```

The demo prints a `MOCK MODE` banner, every state transition, observations, labeled hypotheses, patches with risk,
auto-approves the first non-blocked patch through `approvePatches`, then prints exact baseline/candidate counts
(infra errors and cancels shown separately, `n/a` for a null rate), the decision, reasons and the stopping record.
It exits non-zero if the drive fails or parks somewhere unexpected.

Env vars: `GHOSTLOOP_STDB_URI` and `GHOSTLOOP_STDB_DB` (SpacetimeDB section below); `ANTHROPIC_API_KEY` for
`--analysis claude` (Claude analysis section below).

## SpacetimeDB

Experiment state can live in a SpacetimeDB module (`spacetimedb/`, client in `packages/db`) instead of memory.

Setup: install the CLI with `curl -sSf https://install.spacetimedb.com | sh`, then `npm install` at the repo root.

Runbook (three terminals, from the repo root):

```sh
npm run stdb:start                           # 1: local server on 127.0.0.1:3000
npm run stdb:publish && npm run stdb:watch   # 2: publish the module, then print every row change live
npm run demo:mock -- --store spacetime       # 3: run the demo round against the database
```

The watcher prints `[<table>] <insert|update|delete> <key>` per change (`state=... rev=...` for experiments,
`<kind> <status>` for commands) until Ctrl+C. `npm run worker` is the long-running service the dashboard talks to
through `submit_command`.

- Run `demo:mock --store spacetime` or `worker`, never both: both claim the writer with the same identity and two
  drivers would duplicate adapter work.
- No automatic reconnect: if the server goes away (restart, network drop), `worker`, `demo:mock --store spacetime`
  and `stdb:watch` print `disconnected: <reason>` and exit non-zero. Rerun `npm run worker` once the server is back
  and it resumes: commands left `running` are failed and unfinished experiments continue.
- The writer token is saved at `<repo>/.ghostloop/worker-token` (git-ignored, owner-only); keep it to stay the
  writer across runs.
- Reset with `npm run stdb:publish:fresh`: it deletes all data, including the writer claim. If a run fails with
  `NOT_WRITER`, the token no longer matches the claim; reset the same way. If it fails with `CONNECT_FAILED` and
  says the saved token may be rejected (e.g. the server was reinstalled), delete `.ghostloop/worker-token` to get a
  fresh identity (then reset, since the old identity still holds the writer claim).
- Env vars: `GHOSTLOOP_STDB_URI` (default `ws://127.0.0.1:3000`), `GHOSTLOOP_STDB_DB` (default `ghostloop`).
- `npm run test:live` runs every test including the ones that need a server (`GHOSTLOOP_STDB_TEST=1`); they publish
  their own `ghostloop-test-*` databases. Plain `npm run check` needs no server.

## Claude analysis

`--analysis claude` replaces the mock model with one structured-output call to `claude-opus-5-5` per proposing
step (`src/claude/`). Mocks stay the default.

```sh
export ANTHROPIC_API_KEY=sk-ant-...           # or install the `ant` CLI and run `ant auth login`
npm run demo:mock -- --analysis claude        # add --store spacetime to persist it
npm run worker -- --analysis claude           # the long-running worker, same flag
npm run test:claude                           # one real API call against the fixtures; spends real money (about cents)
```

- Never commit a key; `.env*` is git-ignored. The key stays in this worker and is never logged.
- Without credentials the CLIs warn at startup and the round stops with `INTEGRATION_FAILURE` carrying the SDK error.
- Claude's output is untrusted: `validatePacket` checks every cited observation and element, code assigns risk,
  and protected elements are blocked. An invalid proposal gets one retry, then `NO_VALID_PATCH`.
- A refusal or a truncated answer stops the round with `INTEGRATION_FAILURE`. Refusals first fall back server-side
  to another model (`fallbacks: "default"`); cost is reported per attempt in the experiment's usage.
- Only editable (non-protected) elements are offered to the model; observations may still mention protected ones
  as evidence.

## Module map

| Path | Role |
| --- | --- |
| `src/evaluator.ts` | Run metrics (valid runs, outcome counts, backtracks) and baseline vs candidate comparison |
| `src/policy.ts` | Patch risk classification (protected elements, token allowlist) and feedback packet validation |
| `src/observations.ts` | Observation trends from baseline runs |
| `src/store.ts` | `ExperimentStore` interface and `InMemoryStore` (`onChange` subscription) |
| `src/commands.ts` | Designer commands: create, start, cancel, approve patches, set disposition, final review |
| `src/controller.ts`, `src/controller/*` | Resumable step machine and `ExperimentRuntime` driver |
| `src/mocks/*` | Mock B (simulation), mock model (analysis), mock C (candidates) |
| `src/spacetime-store.ts`, `src/worker.ts`, `src/recovery.ts` | SpacetimeDB store, long-running worker, startup repair |
| `src/claude/*` | Claude analysis adapter, prompt + output schema, pricing, `--analysis` selection |
| `src/cli/demo-mock.ts` | The demo CLI (`--store memory|spacetime`, `--analysis mock|claude`) |
| `src/cli/worker.ts`, `src/cli/watch.ts` | Worker service (`--analysis mock|claude`) and live row watcher |

## State machine

```
created -> baseline_running -> observing -> diagnosing -> proposing -> awaiting_approval
  -> patching -> validating -> candidate_running -> comparing -> accepted | rejected | inconclusive -> stopped
```

Each `step` reads the stored experiment, does one state's work, persists results with the transition, and returns,
so a restart resumes from stored state. `awaiting_approval` (no approval yet) and `accepted` (below target) park the
driver; budgets do not run while parked. Cancel is checked before every step and records `USER_STOP`. Integration
errors stop with `INTEGRATION_FAILURE`; budgets stop with `COST_BUDGET`, `TIME_BUDGET`, `ITERATION_BUDGET`.

## Acceptance rule

Candidates are compared with a fresh retest of the same scenarios against the baseline, using only behaviorally
valid runs (infra errors and cancels are excluded from the rate and reported separately). In order: a failed
guardrail rejects; incomplete data (`minValidFraction`, `minValidPerScenario`) is inconclusive; a secondary
regression (median actions up more than `maxMedianActionsIncrease`, validation-error runs up more than
`maxValidationErrorRateIncreasePp`) rejects; otherwise the completion-rate delta is judged against
`minImprovementPp` (default 10 pp): at or above is `accepted`, at or below the negative is `rejected`, anything
between is `inconclusive`. See `src/evaluator.ts` for the exact order.
Accepted but below `targetCompletionRate` (0.8) parks for a final review instead of stopping. Promotion of the
winner happens only through `recordFinalReview`.

## What is mocked

- **B (simulation):** replays a synthetic batch fixture under the request's batch/version IDs with fresh run IDs.
- **Model (analysis):** deterministic observations-to-patches response, fixed cost (default; `--analysis claude` uses the real model).
- **C (candidates):** every version shares the base manifest; candidates get fresh IDs; validation outcome is selectable.
- **Store:** in-process maps. No persistence.

## Integration checklist

- **B (simulation):** implement `runBatch(BatchRequest)`. The controller uses the incumbent version URL for the
  baseline and the candidate URL for the retest. B receives `experimentId` in the `BatchRequest` and must put it on
  every returned run (the controller still overrides it on the runs it stores, defensively). Streamed events that
  fail `AgentActionEvent` or name another `versionId` are skipped; the validated `BatchResult` copy is stored instead.
- **C (candidates):** implement `createCandidate`, `validateCandidate`, `getManifest` (see
  `packages/contracts/fixtures/README.md` for fixtures and placeholder element IDs). `getManifest(v)` must return a
  manifest whose `versionId` is `v`; a failure or mismatch is `INTEGRATION_FAILURE` (there is no Figma-hash fallback).
- **A (app):** call the commands in `src/commands.ts` and subscribe to `store.onChange(table, key)` for live state.
  A throwing or rejecting listener is ignored and never fails the store write.
  Root scripts are owned by A: the root `package.json` `demo:mock` script was added by D for convenience; A should
  keep or adjust it. It ends with `--` so extra flags reach the CLI.

## Notes for the SpacetimeDB store (next slice)

- `updateExperiment(id, change)` must be **atomic** (one reducer). The controller and the commands both write the
  experiment while the other may be mid-await; get + put would lose updates (e.g. a cancel flag).
- Approval must be **one reducer**: claim the round, set patch states (approved/declined) and insert the `Approval`
  record together. The Approval record is the commit marker; patching follows it.
- `putApproval` and `insertVersion` are **insert-only**; a duplicate must fail.
- `putCandidate(experimentId, c)` records ownership explicitly; never infer it from `patchIds` or evaluations.
  Updating keeps the owner and rejects a different `experimentId`.

## Next slices

1. Real B and C adapters replacing the mocks.
