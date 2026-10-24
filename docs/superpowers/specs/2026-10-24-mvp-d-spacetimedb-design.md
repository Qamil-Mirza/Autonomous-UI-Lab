# MVP D, slice 2: SpacetimeDB storage — design

Issue: #4 ("Validate SpacetimeDB and store experiment state", "Expose commands and worker adapters", acceptance
check "a live SpacetimeDB write is visible to a client"). Builds on the merged contracts (#5) and optimizer (#6).

## 1. Intent

The optimizer's state lives in `InMemoryStore`: it vanishes when the process exits and no other program can see it.
This slice puts that state in a SpacetimeDB database so that:

- the dashboard (A) sees a round progress live by subscribing, never by polling;
- a worker restart resumes the experiment from stored state (the controller is already a resumable step machine);
- the rules that must hold even if code elsewhere is wrong (insert-only history, one approval per round, no stale
  approval, no double-counted actions) are enforced inside database transactions.

Demo day runs everything on **one laptop** against a local `spacetime start` server (user decision). Maincloud is not
needed; switching to it later is a URI/database-name change only.

## 2. Goals, non-goals, anti-goals

Goals
- `spacetimedb/` TypeScript module with one table per stored record kind (§4) and the reducers that write them.
- `SpacetimeStore` in the optimizer implementing the existing `ExperimentStore` interface. Evaluator and policy code
  do not change; controller and commands do not change either (crash recovery is a separate startup pass, §5.1).
- The existing store test suite runs against both `InMemoryStore` and `SpacetimeStore`.
- `npm run demo:mock -- --store spacetime` runs a full mock round against the live database.
- A watcher script that subscribes and prints every change: the "write reaches a subscribed client" proof.
- Restart proof: kill the worker mid-round, restart it, and the round finishes from stored state.
- A committed client package for A (and B if they want to read) with generated bindings, a `connect()` helper and
  typed readers, plus a designer-command path A can call.

Non-goals (later slices): real Claude adapter, real B/C adapters, dashboard UI, Maincloud, auth beyond §6,
schema migrations (we republish with `--delete-data` while iterating).

Anti-goals — this slice fails even if it "works" when:
- A second copy of the domain rules (approval checks, policy, metrics) appears in the module and drifts from the
  tested worker code.
- The dashboard or any non-worker client can write experiment state directly.
- Image bytes or other large blobs get stored (screenshot references only).
- Model keys or browser execution move into the module.

## 3. Architecture (verified by a throwaway probe on CLI 2.13.0, 2026-10-24)

```
 dashboard (A) ──submit_command──▶ ┌────────────── SpacetimeDB (local) ──────────────┐
      ▲                            │ command table (requests + results)              │
      │ subscribe                  │ domain tables: experiment, design_version, ...  │
      │                            └──────────────────────────────────────────────────┘
      │                                   ▲ reducers (sole writer)   │ subscription cache
      └──────────── live updates ─────────┤                          ▼
                                   optimizer worker: SpacetimeStore ← controller, commands, B/C adapters
```

- **The worker is the only writer of domain tables.** Designer actions reach it through a `command` table (§5); the
  worker runs the existing, tested `createCommands` handlers and writes the result back. B's events already arrive
  in the worker through `runBatch(request, onEvent)`, so B's "event sink" is the worker's `insertAction` path, not a
  direct B → database connection.
- **Reads come from the SDK's subscription cache.** The worker subscribes to all domain tables at startup and
  `SpacetimeStore` reads parse rows from `conn.db`. Probe result: after `await conn.reducers.x(...)` resolves, the
  writer's own cache already shows the write (0 misses in 200 sequential writes). Reducer failures reject the promise
  with the `SenderError` message.
- **`updateExperiment(id, change)` is optimistic concurrency.** The experiment row has a `rev` counter. The store
  reads the cached row, applies `change`, and calls `put_experiment(json, expectedRev)`; the reducer rejects
  `STALE_REV` if `rev` moved. The store retries (re-read, re-apply) up to 5 times, then throws. Inside one worker
  process the store also serializes calls per experiment ID, so retries only happen if a second writer exists.
- **Rows are hybrid:** the columns needed for lookups, indexes and subscription filters (ids, `experimentId`,
  `round`, `state`, `runId`/`seq`, timestamps) plus a `json` column holding the full contract object. Readers
  validate `json` with the `@ghostloop/contracts` zod schemas, so contracts stay the single source of truth.
  (SpacetimeDB guidance prefers typed columns; duplicating every nested contract type as module types would be a
  second schema to keep in sync. This is the deliberate trade.)

## 4. Tables

One table per `StoreTable` value in `workers/optimizer/src/store.ts`, plus `command` and `writer`. All tables are
`public: true` (one laptop, fictional data). Every write reducer except `submit_command` checks `ctx.sender` is the
registered writer (§6).

| Table | Key | Extra columns | Write rule enforced in the module |
|---|---|---|---|
| `experiment` | `id` | `rev u64`, `state`, `round`, `updatedAt` | CAS on `rev` |
| `design_version` | `id` | `experimentId?`, `parentId?` | insert-only (existing id → reject) |
| `batch` | `id` | `experimentId`, `round` | upsert |
| `agent_run` | `id` | `batchId`, `experimentId` | upsert |
| `agent_action` | `runId#seq` | `runId`, `seq`, `batchId` | duplicate key → no-op, reducer returns normally (store reports `false`) |
| `observation` | `id` | `experimentId` | upsert |
| `disposition` | `fingerprint` | — | upsert |
| `hypothesis` | `id` | `experimentId`, `round` | upsert |
| `packet` | `id` | `experimentId`, `round` | upsert |
| `patch` | `id` | `experimentId`, `round`, `state` | upsert |
| `approval` | `experimentId#round` | `experimentId`, `round` | insert-only; also rejected unless the stored experiment's incumbent version equals the approval's `sourceVersionId` |
| `candidate` | `id` | `experimentId` (owner, from `putCandidate`) | upsert; owner cannot change |
| `validation` | `candidateId` | — | upsert |
| `evaluation` | `id` | `experimentId` | upsert |
| `command` | `id` (auto-inc) | `kind`, `payloadJson`, `status` (`pending`/`ok`/`error`), `resultJson?`, `submittedBy`, `submittedAt`, `completedAt?` | `submit_command` inserts `pending`; only the writer may complete it |
| `writer` | singleton | `identity` | see §6 |

Every `json` argument over 256 KiB is rejected (`TOO_LARGE`): a guard against blobs, far above any real record.
For `agent_action`, the dedupe key is the contract's run ID and sequence number, matching
`InMemoryStore.insertAction` semantics today.

The approval stale check reads `incumbentVersionId` out of the experiment's `json` with `JSON.parse`; it is the only
domain rule duplicated in the module, kept because a stale approval mutating the wrong incumbent is the failure the
issue names explicitly.

## 5. Designer commands over the database

- A calls `submit_command({ kind, payloadJson })`, where `kind` is one of the six command names and the payload is
  the matching contract shape from `packages/contracts/src/commands.ts`. Any identity may submit.
- The worker subscribes to `command` rows with `status = 'pending'` and processes them one at a time in id order:
  it first calls `start_command(id)` (status → `running`), then runs `createCommands`, then calls
  `complete_command({ id, ok, resultJson })` with the `CommandResult`. Delivery is **at most once**.
- A shows the outcome by watching its command row change to `ok`/`error`.
- Commands submitted while the worker is down stay `pending` and run when it starts.
- A command whose processing throws is completed as `error` with code `INTERNAL` so nothing stays pending forever.
  Add `INTERNAL` to `CommandErrorCode` (it is not there today).
- On startup the worker completes every `running` row as `error` / `INTERNAL` / "worker restarted; resubmit". The
  designer sees it and resubmits. This rules out a re-run creating a second experiment.

### 5.1 Crash recovery inside a command

`approvePatches` writes in order: claim the round (`round.approvalId`) → patch states → Approval record (commit
marker). A crash after the claim but before the Approval used to be unreachable in memory; with a real database it
leaves the round claimed with no Approval, so it would park forever and every retry would get `ALREADY_APPROVED`.
Fix: a startup recovery pass, `recoverInterruptedApprovals(store)`, runs in the worker (and in
`demo:mock --store spacetime`) after hydration and before any command or drive. For every experiment in
`awaiting_approval` whose round has `approvalId` set but no Approval record, it clears the claim and sets the round's
`approved`/`declined` patches back to `proposed`. The designer's resubmitted approval then succeeds. It must not run
inside `step()`: within a live process a drive can observe the window between the claim and the Approval write of an
approval that is still in progress, and repairing there would undo it. Cover this with a test on both stores.

## 6. Writer identity

The module has a `writer` singleton. `claim_writer()` sets it to `ctx.sender` if it is empty and is a no-op if the
caller already holds it; anyone else gets `NOT_WRITER`. The worker persists its SpacetimeDB token in
`.ghostloop/worker-token` (git-ignored) so it keeps the same identity across restarts, and claims on startup.
Resetting means republishing with `--delete-data`. This is hackathon-grade protection against accidental writes
from the dashboard, not security.

## 7. Packages and files

- `spacetimedb/` — the module (`src/schema.ts`, `src/index.ts`), own `package.json` with `spacetimedb` 2.13.x, the
  tsconfig `spacetime init` generates. Added to root workspaces.
- `packages/db/` (`@ghostloop/db`) — browser-safe (no Node-only APIs; the token is passed in, never read from
  disk), so A can use it from a browser dashboard or a Node process. Committed generated bindings (`src/bindings/`), `connect({ uri, database,
  token? })`, typed readers (`readExperiment(row)` etc. that parse `json` with contracts), and
  `submitCommand(conn, kind, payload)` which resolves with the `CommandResult` once the row completes.
- `workers/optimizer/src/spacetime-store.ts` — `SpacetimeStore` (built on `@ghostloop/db`), plus
  `workers/optimizer/src/cli/worker.ts` (long-running worker: connect, claim writer, hydrate, process commands,
  drive experiments with `ExperimentRuntime`, resume any experiment not in a terminal state) and
  `workers/optimizer/src/cli/watch.ts`.
- Root scripts: `stdb:start` (`spacetime start`), `stdb:publish` (publish to local as `ghostloop`), `stdb:generate`
  (regenerate bindings into `packages/db/src/bindings`), `stdb:watch`. Root `package.json` is A's file; these are
  additive and noted in the PR.

Env: `GHOSTLOOP_STDB_URI` (default `ws://127.0.0.1:3000`), `GHOSTLOOP_STDB_DB` (default `ghostloop`).

## 8. Testing

- The current `store.test.ts` cases become a shared suite run against `InMemoryStore` (always) and `SpacetimeStore`
  (only when `GHOSTLOOP_STDB_TEST=1`, against a database the test publishes fresh). `npm run check` stays green
  with no server.
- Live-only tests: duplicate action is a no-op; insert-only version/approval rejections; stale approval rejected;
  `STALE_REV` retry path (two connections racing); `TOO_LARGE`; non-writer write rejected; `submit_command` round
  trip; a mock round through the worker reaches a terminal state; a worker killed mid-round resumes and finishes.
- **Restart proof is deterministic, not a timed kill.** A live test drives the controller with `step()` on one
  `SpacetimeStore` connection, drops that connection and store at a chosen point, builds a fresh connection and
  store, and drives to a terminal state. Restart points: `baseline_running` (batch in flight) and
  `awaiting_approval` with a claim but no Approval (§5.1). The test submits `approvePatches` through
  `submit_command`, as A would.
- Runbook check in the README: `stdb:start`, `stdb:publish`, `stdb:watch` in one terminal, `demo:mock -- --store
  spacetime` in another, and the watcher prints the round live.

## 8.1 Who writes during a demo

- `demo:mock -- --store spacetime` is a self-contained writer: it drives the round in-process, claims the writer with
  the same `.ghostloop/worker-token` as `worker.ts`, and auto-approves as it does today.
- `worker.ts` is the long-running service A talks to through `submit_command`.
- Run one or the other, never both at once (README says so). Both share one identity, so the module cannot tell them
  apart; per-experiment CAS keeps stored state consistent, but two drivers would duplicate adapter work.

## 9. Left to the builder

Exact reducer argument shapes, how hydration waits for `onApplied`, how `onChange` maps from SDK row callbacks
(all tables, including writes from other connections), retry/backoff details, and file splits inside the module.

## 10. Calls I made (not user decisions)

- C1: worker is the sole writer; dashboard commands go through a `command` table instead of domain reducers.
- C2: hybrid rows (index columns + contract `json`), validated with contracts on read.
- C3: `updateExperiment` as CAS on `rev` with bounded retry, plus per-ID serialization in process.
- C4: writer identity by first `claim_writer` with a persisted token.
- C5: the approval stale check is the only domain rule duplicated in the module.
- C6: B's event sink is the worker's `insertAction`, since B's events already flow through `runBatch`.
- C7: generated bindings committed in `packages/db` so A/B do not need the CLI to build.
- C8: 256 KiB `json` cap as the blob guard.
- C9: live tests gated by `GHOSTLOOP_STDB_TEST=1`.
- C10: command delivery at most once (`running` status; restart fails in-flight rows as `INTERNAL`).
- C11: a startup recovery pass repairs a claimed-but-unapproved round (§5.1); controller and commands are unchanged.
- C12: restart proof via dropping and rebuilding the store connection in a test, at two named points.
- C13: `demo:mock --store spacetime` writes in-process; `worker.ts` serves A; never run both.
- C14: `@ghostloop/db` is browser-safe; token file handling lives in the worker only.
