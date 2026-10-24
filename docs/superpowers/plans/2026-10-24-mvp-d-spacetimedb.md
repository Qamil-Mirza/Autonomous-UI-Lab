# MVP D SpacetimeDB Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist optimizer state in a local SpacetimeDB database so a worker restart resumes, the dashboard can subscribe, and storage-level invariants hold inside transactions.

**Architecture:** A TypeScript SpacetimeDB module (`spacetimedb/`) stores each record as index columns plus the full contract `json`. The optimizer worker is the only writer, through `SpacetimeStore` (implements the existing `ExperimentStore`, reads from the SDK subscription cache). Designer commands arrive as rows in a `command` table and run through the existing `createCommands`.

**Tech Stack:** SpacetimeDB 2.13 (CLI + `spacetimedb` npm SDK), TypeScript strict ESM, zod 3, vitest, tsx, npm workspaces, Node 22.

**Spec:** `docs/superpowers/specs/2026-10-24-mvp-d-spacetimedb-design.md`

## Global Constraints

- SpacetimeDB CLI 2.13.0; npm dependency `"spacetimedb": "2.13.*"`. No other new runtime dependencies.
- npm only. Node >= 22. TypeScript strict, ESM, `moduleResolution: "Bundler"`, `noEmit`.
- `npm run check` at the root must pass with no SpacetimeDB server and no `spacetime` CLI. Tests that need a server
  run only when `GHOSTLOOP_STDB_TEST=1` (`describe.skipIf(!process.env.GHOSTLOOP_STDB_TEST)`).
- Env: `GHOSTLOOP_STDB_URI` (default `ws://127.0.0.1:3000`), `GHOSTLOOP_STDB_DB` (default `ghostloop`).
- Module reducer errors are `SenderError` with message `CODE: detail`. Codes: `NOT_WRITER`, `STALE_REV`,
  `ALREADY_EXISTS`, `STALE_SOURCE_VERSION`, `TOO_LARGE`, `OWNER_MISMATCH`, `UNKNOWN_COMMAND`, `NOT_RUNNING`,
  `NOT_FOUND`.
- `json` arguments longer than 262144 characters are rejected with `TOO_LARGE`.
- The module imports nothing but `spacetimedb`; contracts validation happens in clients.
- Row keys that combine fields use `:` (`runId:seq`, `experimentId:round`), matching the keys `InMemoryStore` emits.
- Evaluator, policy, controller and commands logic do not change (spec §2, §5.1). `ExperimentStore` gains one
  method, `listExperiments()` (Task 3).
- Fictional data only. Model keys never in the module. Commit messages carry no attribution lines.
- Never commit or modify `docs/MERGE-PLAN.md` or `docs/FIGMA-SPONSOR-BRIEF.md`.

## Review Focus

1. Server not running or module not published: `connect` rejects within its timeout with `CONNECT_FAILED`, never
   hangs (Task 2 test, runs without a server).
2. Worker token file lost after the writer was claimed: startup fails with `NOT_WRITER` and a hint naming
   `npm run stdb:publish:fresh` (Task 5 live test).
3. Designer submits malformed JSON or an invalid payload: the command row ends `error` / `VALIDATION_FAILED`, never
   stays `pending`; an unknown kind is refused at submit with `UNKNOWN_COMMAND` (Tasks 2 and 5 live tests).
4. A store used right after opening: `SpacetimeStore.open` resolves only after the subscription is applied, so a
   freshly opened store reads rows written earlier (Task 4 live test).
5. A row whose `json` does not match the contract: readers throw `RowValidationError` naming table and key, never
   return a half-valid object (Task 2 test, runs without a server).

---

### Task 1: SpacetimeDB module and workspace wiring

**Files:**
- Create: `spacetimedb/package.json` (name `@ghostloop/spacetimedb-module`, scripts `check: "tsc -p ."`,
  `build: "spacetime build"`), `spacetimedb/tsconfig.json` (the one `spacetime init --lang typescript` generates,
  unmodified), `spacetimedb/src/schema.ts`, `spacetimedb/src/index.ts`
- Modify: root `package.json` (workspaces add `"spacetimedb"`, scripts below), `.gitignore` (add `.ghostloop/`)

**Interfaces:**
- Produces tables (all `public: true`, snake_case `name`, camelCase accessors):

| accessor / name | primary key | other columns |
|---|---|---|
| `writer` / `writer` | `slot: u8` (always 0) | `identity: identity` |
| `experiment` | `id: string` | `rev: u64`, `state: string`, `round: u32`, `updatedAt: timestamp`, `json` |
| `designVersion` / `design_version` | `id` | `parentId: option<string>`, `json` |
| `batch` | `id` | `experimentId` (btree), `round: u32`, `json` |
| `agentRun` / `agent_run` | `id` | `batchId` (btree), `json` |
| `agentAction` / `agent_action` | `key` (`runId:seq`) | `runId` (btree), `seq: u32`, `json` |
| `observation` | `id` | `experimentId` (btree), `json` |
| `disposition` | `fingerprint` | `disposition: string` |
| `hypothesis` | `id` | `experimentId` (btree), `round: u32`, `json` |
| `packet` | `id` | `experimentId` (btree), `round: u32`, `json` |
| `patch` | `id` | `experimentId` (btree), `round: u32`, `state: string`, `json` |
| `approval` | `key` (`experimentId:round`) | `experimentId` (btree), `round: u32`, `json` |
| `candidate` | `id` | `experimentId` (btree), `json` |
| `validation` | `candidateId` | `json` |
| `evaluation` | `id` | `experimentId` (btree), `json` |
| `command` | `id: u64` autoInc | `kind`, `payloadJson`, `status` (`pending`/`running`/`ok`/`error`), `resultJson: option<string>`, `submittedBy: identity`, `submittedAt: timestamp`, `completedAt: option<timestamp>` |

- Produces reducers (export name → behavior). All except `submitCommand` require `ctx.sender` = writer, else
  `NOT_WRITER`. All `json`/`payloadJson`/`resultJson` arguments go through the `TOO_LARGE` check.
  - `claimWriter()`: set writer if empty; no-op if caller holds it; else `NOT_WRITER`.
  - `devReset()`: delete every row of every table except `writer`.
  - `putExperiment({ id, state, round, expectedRev: u64, json })`: current rev (0 if absent) must equal
    `expectedRev`, else `STALE_REV`; writes `rev + 1`, `updatedAt = ctx.timestamp`.
  - `insertVersion({ id, parentId, json })`: existing id → `ALREADY_EXISTS`.
  - `putBatch`, `putRun`, `putObservation`, `setDisposition`, `putHypothesis`, `putPacket`, `putPatch`,
    `putValidation`, `putEvaluation`: upsert, arguments = the table's columns.
  - `insertAction({ runId, seq, json })`: existing key → return without writing.
  - `putApproval({ experimentId, round, sourceVersionId, json })`: existing key → `ALREADY_EXISTS`; experiment
    missing → `NOT_FOUND`; `JSON.parse(experiment.json).incumbentVersionId !== sourceVersionId` →
    `STALE_SOURCE_VERSION`.
  - `putCandidate({ id, experimentId, json })`: existing row with a different `experimentId` → `OWNER_MISMATCH`.
  - `submitCommand({ kind, payloadJson })`: any caller; `kind` must be one of `createExperiment`,
    `startExperiment`, `cancelExperiment`, `setObservationDisposition`, `approvePatches`, `recordFinalReview`, else
    `UNKNOWN_COMMAND`; inserts `pending` with `submittedBy = ctx.sender`.
  - `startCommand({ id })`: `pending` → `running`, else `NOT_RUNNING`.
  - `completeCommand({ id, ok: bool, resultJson })`: `running` → `ok`/`error` with `completedAt`, else
    `NOT_RUNNING`.
- Produces root scripts:
  - `"stdb:start": "spacetime start"`
  - `"stdb:publish": "spacetime publish --server local --module-path spacetimedb --yes ghostloop"`
  - `"stdb:publish:fresh": "spacetime publish --server local --module-path spacetimedb --delete-data --yes ghostloop"`
  - `"stdb:generate": "spacetime generate --lang typescript --out-dir packages/db/src/bindings --module-path spacetimedb --yes"`

- [ ] **Step 1:** Write the schema and reducers (SDK reference: the `.cursor/rules/typescript-server.mdc` that
  `spacetime init` writes; key rules: `schema({...})` default export, reducers as `export const`, `0n` for u64,
  `ctx.timestamp` not `Date`).
- [ ] **Step 2:** `npm install` at the root, then `npm run check -w @ghostloop/spacetimedb-module`. Expected: tsc
  passes.
- [ ] **Step 3:** With `npm run stdb:start` running in another terminal: `npm run stdb:publish` succeeds, then
  `spacetime call --server local ghostloop claim_writer` succeeds and
  `spacetime sql --server local ghostloop "SELECT * FROM writer"` shows one row. (Use the CLI's snake_case reducer
  name.) If `spacetime build` cannot resolve `spacetimedb` from the hoisted root `node_modules`, add it to the
  module's own install (`npm install --prefix spacetimedb --no-workspaces`) and note that in the report.
- [ ] **Step 4:** Root `npm run check` still passes.
- [ ] **Step 5:** Commit `feat(spacetimedb): module tables and reducers`.

### Task 2: `@ghostloop/db` client package and live module tests

**Files:**
- Create: `packages/db/package.json` (deps `@ghostloop/contracts`, `spacetimedb: "2.13.*"`, `zod`; exports `"."`
  → `./src/index.ts`, `"./test-support"` → `./test-support/live.ts`; scripts `check: "tsc -p . && vitest run"`,
  `test: "vitest run"`), `packages/db/tsconfig.json` (extends base, `lib: ["ES2022", "DOM"]`, no Node types in
  `src`), `packages/db/src/bindings/**` (generated by `npm run stdb:generate`, committed),
  `packages/db/src/connect.ts`, `packages/db/src/rows.ts`, `packages/db/src/commands.ts`, `packages/db/src/index.ts`,
  `packages/db/test-support/live.ts`, `packages/db/test/rows.test.ts`, `packages/db/test/connect.test.ts`,
  `packages/db/test/module.live.test.ts`, `packages/db/README.md`
- Modify: `packages/contracts/src/commands.ts` (add `CommandKind` enum with the six kinds, and `"INTERNAL"` to
  `CommandErrorCode`)

**Interfaces:**
- Consumes: Task 1 tables/reducers.
- Produces (from `@ghostloop/db`, browser-safe: no `node:` imports in `src`):
  - `DEFAULT_URI = "ws://127.0.0.1:3000"`, `DEFAULT_DATABASE = "ghostloop"`
  - `connect(opts: { uri?: string; database?: string; token?: string; subscribe?: string[]; timeoutMs?: number }): Promise<{ conn: DbConnection; identity: Identity; token: string }>`
    — resolves after the subscription is applied (default: `SELECT * FROM <table>` for every table); rejects with
    an `Error` whose message starts `CONNECT_FAILED:` on connect error or after `timeoutMs` (default 5000).
  - `class RowValidationError extends Error` and `parseRow<T>(schema: z.ZodType<T>, table: string, key: string, json: string): T`
    — throws `RowValidationError` with message `${table} ${key}: <issues or JSON error>`.
  - `reducerErrorCode(err: unknown): string | undefined` — the `CODE` prefix of a reducer rejection.
  - `submitCommand(conn: DbConnection, kind: CommandKind, payload: unknown, opts?: { timeoutMs?: number }): Promise<CommandResult<unknown>>`
    — resolves when this submission's row reaches `ok`/`error` (default timeout 30000 → rejects
    `COMMAND_TIMEOUT:`). Concurrent submits from one connection each resolve with their own result.
  - Re-exports `DbConnection`, `tables` and row types from the bindings.
- Produces (from `@ghostloop/db/test-support`, Node-only):
  `publishTestDb(name: string): Promise<{ uri: string; database: string }>` — runs
  `spacetime publish --server <http form of GHOSTLOOP_STDB_URI> --module-path <repo>/spacetimedb --delete-data --yes <name>`
  once per process per name; throws a message naming `npm run stdb:start` if the CLI or server is missing.

- [ ] **Step 1: Failing tests that need no server.**
  - `rows.test.ts`: `parseRow(Experiment, "experiment", "exp_x", "{")` throws `RowValidationError` whose message
    contains `experiment exp_x`; same for valid JSON that fails the schema; a fixture experiment round-trips equal.
  - `connect.test.ts`: `connect({ uri: "ws://127.0.0.1:1", timeoutMs: 1000 })` rejects with message matching
    `/^CONNECT_FAILED:/` within 3000 ms.
- [ ] **Step 2:** Run `npm test -w @ghostloop/db`; expected FAIL (modules missing).
- [ ] **Step 3:** Generate bindings (`npm run stdb:generate`) and implement `src/`.
- [ ] **Step 4: Live tests** in `module.live.test.ts` (each test file publishes its own database via
  `publishTestDb("ghostloop-test-db")`; `beforeEach` calls `devReset` as the writer):
  - two `insertAction` calls with the same run/seq leave one `agent_action` row;
  - second `insertVersion` with the same id rejects with code `ALREADY_EXISTS`;
  - `putExperiment` with a stale `expectedRev` rejects `STALE_REV`; with the current rev succeeds and `rev`
    increments by 1;
  - `putApproval` twice for the same key rejects `ALREADY_EXISTS`; with `sourceVersionId` ≠ the experiment JSON's
    `incumbentVersionId` rejects `STALE_SOURCE_VERSION`;
  - `putCandidate` with a different `experimentId` for an existing id rejects `OWNER_MISMATCH`;
  - a 262145-character `json` rejects `TOO_LARGE`;
  - a second identity calling `putBatch` or `devReset` rejects `NOT_WRITER`, but its `submitCommand` succeeds and
    an unknown `kind` rejects `UNKNOWN_COMMAND`;
  - `startCommand` on a non-pending row and `completeCommand` on a non-running row reject `NOT_RUNNING`;
  - `submitCommand` helper: the writer connection starts and completes the row with `{ ok: true, value: 1 }`, and
    the helper resolves with exactly that result.
- [ ] **Step 5:** `npm run check -w @ghostloop/db` passes without a server; with `npm run stdb:start` running,
  `GHOSTLOOP_STDB_TEST=1 npm test -w @ghostloop/db` passes.
- [ ] **Step 6:** README: how A connects (browser or Node), subscribes, reads rows with `parseRow` and the
  contracts schemas, submits commands, and the regenerate rule (`npm run stdb:generate` after any module change).
- [ ] **Step 7:** Commit `feat(db): client package, bindings and live module tests`.

### Task 3: Shared store test suite, `listExperiments`, startup approval recovery

**Files:**
- Create: `workers/optimizer/test/store-contract.ts`, `workers/optimizer/src/recovery.ts`,
  `workers/optimizer/test/recovery.test.ts`
- Modify: `workers/optimizer/src/store.ts` (interface + `InMemoryStore.listExperiments`),
  `workers/optimizer/test/store.test.ts` (becomes a call to the shared suite)

**Interfaces:**
- Produces: `ExperimentStore.listExperiments(): Promise<Experiment[]>`.
- Produces: `runStoreContract(name: string, open: () => Promise<{ store: ExperimentStore; close?: () => Promise<void> }>): void`
  — registers every current `store.test.ts` case (moved, not rewritten) plus a `listExperiments` case, each test
  calling `open()` for an empty store.
- Produces: `recoverInterruptedApprovals(store: ExperimentStore): Promise<string[]>` — for each experiment with
  `state === "awaiting_approval"`, `round.approvalId` set and no `getApproval(id, round.index)`: clear
  `round.approvalId` via `updateExperiment`, set that round's `approved`/`declined` patches to `proposed`; returns the
  repaired experiment ids.

- [ ] **Step 1:** Move the cases into `runStoreContract`; `store.test.ts` calls
  `runStoreContract("InMemoryStore", async () => ({ store: new InMemoryStore() }))`. Run
  `npm test -w @ghostloop/optimizer`: same count of store tests pass (14) plus the new `listExperiments` case
  failing until implemented.
- [ ] **Step 2:** Implement `listExperiments`; tests pass.
- [ ] **Step 3: Failing recovery tests** (`recovery.test.ts`, InMemoryStore, driven to `awaiting_approval` with the
  mock adapters as `controller.test.ts` does):
  - claim set (`round.approvalId = "appr_x"`), one patch `approved`, one `declined`, no Approval → returns `[id]`,
    `approvalId` cleared, both patches `proposed`, blocked patches unchanged; a following `approvePatches` succeeds
    and the drive reaches a decision state.
  - an experiment whose Approval exists is untouched and not returned; an experiment in another state is untouched.
- [ ] **Step 4:** Implement; `npm run check -w @ghostloop/optimizer` passes.
- [ ] **Step 5:** Commit `feat(optimizer): shared store suite, listExperiments, startup approval recovery`.

### Task 4: `SpacetimeStore`

**Files:**
- Create: `workers/optimizer/src/spacetime-store.ts`, `workers/optimizer/test/spacetime-store.live.test.ts`
- Modify: `workers/optimizer/package.json` (dependency `@ghostloop/db: "*"`)

**Interfaces:**
- Consumes: `connect`, `parseRow`, `reducerErrorCode` (Task 2); `ExperimentStore` incl. `listExperiments` (Task 3).
- Produces: `class SpacetimeStore implements ExperimentStore` with
  - `static open(opts: { uri: string; database: string; token?: string; timeoutMs?: number }): Promise<SpacetimeStore>`
    — connects, waits for the subscription, calls `claimWriter`; on `NOT_WRITER` rejects with an `Error` whose
    message starts `NOT_WRITER:` and contains `npm run stdb:publish:fresh`.
  - `readonly token: string`, `readonly connection: DbConnection`, `close(): Promise<void>`, `devReset(): Promise<void>`.
- Behavior to match `InMemoryStore` (the shared suite is the judge): reads parse cached rows with contracts schemas;
  `insertAction` returns `false` when the key is already cached; `putRun` stores the run without `events` and
  inserts each event; `listRuns` rebuilds events from `agent_action`; `updateExperiment` serializes per id in process
  and retries `STALE_REV` up to 5 attempts (re-read, re-apply `change`), then throws; `putExperiment` uses the cached
  rev; `onChange` maps every table's insert/update/delete callbacks (local and remote writes) to the `StoreTable` name
  and key, swallowing listener errors.

- [ ] **Step 1: Live tests** (`publishTestDb("ghostloop-test-store")`):
  - `runStoreContract("SpacetimeStore", ...)`: `open` returns a store on the shared connection token after
    `devReset`.
  - two stores (same token, separate connections) each run `updateExperiment` 10 times concurrently on one
    experiment, incrementing a counter in `usage.runs` (or another numeric field) → final value 20.
  - write with store A, then `SpacetimeStore.open` B with the same token and immediately `getExperiment` → found.
  - a listener on store A sees `("experiments", id)` for a write made through store B.
  - opening with a fresh identity after the writer is claimed rejects with `NOT_WRITER:` and the
    `stdb:publish:fresh` hint.
- [ ] **Step 2:** Run with a server (`GHOSTLOOP_STDB_TEST=1 npm test -w @ghostloop/optimizer`); expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Live tests pass; `npm run check` at the root passes without a server.
- [ ] **Step 5:** Commit `feat(optimizer): SpacetimeStore`.

### Task 5: Worker service, command processor, restart proof

**Files:**
- Create: `workers/optimizer/src/command-processor.ts`, `workers/optimizer/src/worker.ts`,
  `workers/optimizer/src/cli/worker.ts`, `workers/optimizer/test/worker.live.test.ts`
- Modify: `workers/optimizer/package.json` (script `"worker": "tsx src/cli/worker.ts"`), root `package.json`
  (script `"worker": "npm run worker -w @ghostloop/optimizer --"`)

**Interfaces:**
- Consumes: `SpacetimeStore` (Task 4), `recoverInterruptedApprovals` (Task 3), `createCommands`,
  `ExperimentRuntime`, mocks.
- Produces: `createCommandProcessor(conn: DbConnection, commands: ReturnType<typeof createCommands>, log: (line: string) => void): { start(): void; idle(): Promise<void>; failRunning(): Promise<number> }`
  — processes `pending` rows one at a time in id order: `startCommand` → `JSON.parse(payloadJson)` (failure →
  `VALIDATION_FAILED`) → the matching handler → `completeCommand` with the `CommandResult` JSON; a thrown handler
  completes `error` / `INTERNAL`. `failRunning` completes every `running` row as `error` / `INTERNAL` /
  `"worker restarted; resubmit"`. `idle` resolves when nothing is pending or in progress.
- Produces: `startWorker(opts: { uri: string; database: string; tokenPath: string; adapters?: Partial<Pick<ControllerDeps, "simulation" | "analysis" | "candidates">>; log?: (line: string) => void }): Promise<{ store: SpacetimeStore; runtime: ExperimentRuntime; processor: ReturnType<typeof createCommandProcessor>; close(): Promise<void> }>`
  — order: read token file if present → `SpacetimeStore.open` → write token file (create its directory) →
  `failRunning` → `recoverInterruptedApprovals` → build runtime (default adapters: the demo's mocks, improved
  candidate) and commands → `runtime.launch` every experiment not `stopped` → `processor.start()`. `close()` closes
  the connection without aborting the runtime (an abort would record `USER_STOP`).
- CLI `src/cli/worker.ts`: env URI/DB, token path `<repo>/.ghostloop/worker-token`, prints a `MOCK ADAPTERS`
  banner, runs until SIGINT.

- [ ] **Step 1: Live tests** (`publishTestDb("ghostloop-test-worker")`, token path in a temp dir, a second
  anonymous `connect` acting as the dashboard):
  - full round through commands: dashboard `submitCommand("createExperiment", ...)` and `"startExperiment"` → worker
    parks at `awaiting_approval`; dashboard `"approvePatches"` for the first non-blocked patch → experiment reaches
    `accepted` with an evaluation (improved fixture).
  - `submitCommand` with an invalid payload resolves `{ ok: false, code: "VALIDATION_FAILED" }`.
  - a `running` command left by a closed worker is completed `error` / `INTERNAL` by the next `startWorker`.
  - **restart at `baseline_running`:** first worker uses a simulation whose `runBatch` never settles; once the
    experiment is `baseline_running`, `close()` it; second `startWorker` (same token, default mocks) resumes; after
    approval the evaluation's baseline metrics are 6 successes of 12 valid runs (no double counting).
  - **restart with a half-written approval:** at `awaiting_approval`, set `round.approvalId` and mark a patch
    `approved` through the store with no Approval, `close()`; second worker repairs it (`approvalId` cleared,
    patch `proposed`) and a resubmitted `"approvePatches"` succeeds and the round finishes.
  - starting with a different token file after the writer is claimed rejects `NOT_WRITER:` with the
    `npm run stdb:publish:fresh` hint.
- [ ] **Step 2:** Run live; expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Live tests pass; root `npm run check` passes without a server.
- [ ] **Step 5:** Commit `feat(optimizer): worker service with command processor and restart recovery`.

### Task 6: Demo on SpacetimeDB, watcher, runbook

**Files:**
- Create: `workers/optimizer/src/cli/watch.ts`
- Modify: `workers/optimizer/src/cli/demo-mock.ts`, `workers/optimizer/test/demo-mock.test.ts`,
  `workers/optimizer/package.json` (script `"watch": "tsx src/cli/watch.ts"`), root `package.json` (scripts
  `"stdb:watch": "npm run watch -w @ghostloop/optimizer"`, `"test:live": "GHOSTLOOP_STDB_TEST=1 npm test --workspaces --if-present"`),
  `workers/optimizer/README.md`

**Interfaces:**
- Consumes: `SpacetimeStore`, `recoverInterruptedApprovals`, `connect`.
- Produces: `main(argv, log)` accepts `--store memory|spacetime` (default `memory`; any other value throws
  `--store must be one of: memory, spacetime`). `spacetime` opens a `SpacetimeStore` from env with the
  `.ghostloop/worker-token` token, runs `recoverInterruptedApprovals`, then the unchanged flow and output (the
  hypotheses capture must work for both stores), and closes the store at the end.
- `watch.ts`: anonymous `connect`, prints one line per insert/update/delete:
  `[<table>] <insert|update|delete> <key>` plus `state=<state> rev=<rev>` for `experiment` and
  `<kind> <status>` for `command`; runs until SIGINT.

- [ ] **Step 1: Tests:** `demo-mock.test.ts` adds `--store bogus` rejecting with the message above and a live case
  (`publishTestDb("ghostloop-test-demo")`, env pointed at it) where `main(["--store", "spacetime"])` returns
  `{ decision: "accepted", stoppingReason: "USER_STOP" }`.
- [ ] **Step 2:** Implement; tests pass (live with a server, the rest without).
- [ ] **Step 3: Manual runbook check:** terminal 1 `npm run stdb:start`; terminal 2 `npm run stdb:publish && npm run stdb:watch`;
  terminal 3 `npm run demo:mock -- --store spacetime`. Expected: the watcher prints the experiment's state changes
  live. Record the observed output excerpt in the task report.
- [ ] **Step 4:** README: SpacetimeDB section with setup (`curl -sSf https://install.spacetimedb.com | sh`), the
  runbook above, `npm run worker`, `npm run test:live`, env vars, "run `demo:mock --store spacetime` or `worker`,
  never both", resetting with `npm run stdb:publish:fresh` (also deletes the writer claim), and the
  `.ghostloop/worker-token` note.
- [ ] **Step 5:** Root `npm run check` passes without a server; `npm run test:live` passes with one.
- [ ] **Step 6:** Commit `feat(optimizer): demo on SpacetimeDB, watcher and runbook`.
