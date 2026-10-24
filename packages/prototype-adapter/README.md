# @ghostloop/prototype-adapter

Run-isolated application state for the Matrix Coor onboarding prototype (`apps/prototype`), the simulated invite service, and the trusted goal checker.

- **Run state.** Each run has its own JSON file, `<runs dir>/<runId>.json`. It holds the account, workspaces, plan, paid-trial flag and sent invites. Two runs never share state.
- **HTTP API.** It is served by the prototype's Vite server under `/api/runs/...`, on the same port as the app, in both `dev` and `preview`. Every submit in the app goes through it, and a screen advances only when the server accepts the submit.
- **`checkGoal(runId)`** returns a `GoalCheckResult` (from `@ghostloop/contracts`) for the demo task: create an account, create exactly one workspace on the Free plan, and invite one teammate without starting a paid trial.

**Trust boundary.** `checkGoal` reads only the persisted run state. It never looks at the DOM, screen text such as a "You're all set" heading, or anything the agent says. An agent that claims success, or that reaches the confirm screen through a bad path, gets no credit unless the state shows the goal was met.

## Quick start

From the repo root:

```sh
npm install
npm run dev -w @ghostloop/prototype          # app + API on http://localhost:5173
```

For a production build, run `npm run build -w @ghostloop/prototype && npm run preview -w @ghostloop/prototype`. That serves the same API on port 4173.

## Harness recipe

This is the sequence group B's runner should follow for each agent run.

1. **Pick a unique run id.** It must match `^run_[A-Za-z0-9_-]+$`, for example `run_${crypto.randomUUID().replaceAll("-", "")}` or `newId("run")` from `@ghostloop/contracts`. Never reuse an id across concurrent runs.
2. **Initialize the run.** Send `POST /api/runs/<runId>/init`, which creates or resets it to empty state. **This step is required.** The app never initializes an id it was given, so if you skip it the first submit fails with the generic `api-error` alert.
3. **Open the app for the agent** at `http://localhost:5173/v/<versionId>/signup?run=<runId>`, for example `/v/ver_baseline/signup?run=run_abc123`. The app carries `?run=` on every navigation, including the Back links.
4. **Let the agent work.**
5. **Verify** with `checkGoal(runId, { baseUrl: "http://localhost:5173" })` or the direct form (see below). Use its result, not the agent's claim, for `goalVerified`.
6. **Optionally clean up** with `DELETE /api/runs/<runId>`. Re-running `init` on the same id also resets it.

```ts
import { checkGoal, RunNotFoundError } from "@ghostloop/prototype-adapter";

const base = "http://localhost:5173";
const runId = `run_${crypto.randomUUID().replaceAll("-", "")}`;

await fetch(`${base}/api/runs/${runId}/init`, { method: "POST" }); // 201
await page.goto(`${base}/v/ver_baseline/signup?run=${runId}`);
// ... agent loop ...
const goal = await checkGoal(runId, { baseUrl: base });
```

**Opening the app without `?run=`.** The app makes a `run_manual_<12 hex>` run, initializes it, and adds it to the URL. This is meant for people clicking through, not for harnesses.

## `checkGoal`

```ts
checkGoal(runId: string, options?: { baseUrl?: string; dir?: string }): Promise<GoalCheckResult>
```

There are two ways to call it, and both run the same pure evaluation (`evaluateGoal(state)`, also exported):

| Call | Reads state from | Use when |
|---|---|---|
| `checkGoal(runId, { baseUrl: "http://localhost:5173" })` | `GET {baseUrl}/api/runs/<runId>/state` | The harness runs in another process or on another machine from the prototype server. This is the recommended form. |
| `checkGoal(runId)` / `checkGoal(runId, { dir })` | `<dir>/<runId>.json` on disk. `dir` defaults to `GHOSTLOOP_RUNS_DIR`, then `<repo>/.runs`. | Same machine with direct file access. It must point at the same directory the server writes to (see below). |

The package exports TypeScript source, like the other workspace packages. Import it from code run with `tsx`, vitest or Playwright, as `workers/optimizer` does.

It throws in three cases:
- **`RunNotFoundError`:** the run was never initialized, or it was deleted. This is a **harness or infrastructure fault, not a failed goal**, so don't record it as a behavioral outcome.
- **An error with message `invalid runId …`:** the id doesn't match `^run_[A-Za-z0-9_-]+$`.
- **A plain `Error`:** for `baseUrl`, any HTTP status other than 200 or 404. Treat it as infrastructure.

### Checks

`achieved` is `true` only when every check passes. The contract enforces this.

| `name` | Passes when |
|---|---|
| `account_created` | Signup was recorded with a non-blank name, a valid email, a password of at least 8 characters (only its length is stored) and consent given. |
| `exactly_one_workspace` | The run has exactly one workspace. The workspace step is an upsert, so going Back and resubmitting renames the workspace and never adds a second one. |
| `free_plan_selected` | The current plan is `free`. |
| `invite_sent` | At least one invite to a valid address has status `sent`. Invalid addresses are rejected by the invite service and never stored. |
| `no_paid_trial` | Pro was never chosen. Choosing Pro sets `paidTrialStarted`, and the flag stays set even if the user goes Back and picks Free. |

A Free happy path:

```json
{
  "runId": "run_doc_free",
  "achieved": true,
  "checks": [
    { "name": "account_created", "passed": true, "detail": "account for alex@northwind.test" },
    { "name": "exactly_one_workspace", "passed": true, "detail": "1 workspace: Northwind Sales" },
    { "name": "free_plan_selected", "passed": true, "detail": "plan is free" },
    { "name": "invite_sent", "passed": true, "detail": "invite sent to jordan@northwind.test" },
    { "name": "no_paid_trial", "passed": true, "detail": "no paid trial started" }
  ],
  "at": "2026-10-24T21:52:51.082Z"
}
```

The same flow choosing Pro fails two checks:

```json
{
  "runId": "run_doc_pro",
  "achieved": false,
  "checks": [
    { "name": "account_created", "passed": true, "detail": "account for alex@northwind.test" },
    { "name": "exactly_one_workspace", "passed": true, "detail": "1 workspace: Northwind Sales" },
    { "name": "free_plan_selected", "passed": false, "detail": "plan is pro" },
    { "name": "invite_sent", "passed": true, "detail": "invite sent to jordan@northwind.test" },
    { "name": "no_paid_trial", "passed": false, "detail": "paid trial started (Pro was chosen)" }
  ],
  "at": "2026-10-24T21:52:51.085Z"
}
```

### Mapping to `AgentRunResult`

```ts
const goal = await checkGoal(runId, { baseUrl });
const goalVerified = goal.achieved;
const goalEvidence = goal.checks.map((c) => `${c.passed ? "✓" : "✗"} ${c.name}: ${c.detail}`).join("\n");
// The contract requires outcome === "goal" exactly when goalVerified is true.
```

## HTTP API

Base path: `/api/runs/<runId>`.
- **`runId`** must match `^run_[A-Za-z0-9_-]+$`; anything else gets a 400.
- **Response headers:** every response has `Cache-Control: no-store`.
- **Request bodies:** JSON, at most 16 kB.
- **Successful responses** return the run's full state, the same shape as `RunState` in `src/state.ts`.

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| POST | `/api/runs/<runId>/init` | none | **201** + empty state (creates or resets) | 400 |
| GET | `/api/runs/<runId>/state` | none | **200** + state | 404 `{"error":"run_not_found"}` |
| DELETE | `/api/runs/<runId>` | none | **204** | 404 |
| POST | `/api/runs/<runId>/signup` | `{"name","email","password","consent":bool}` | **200** + state | 422, 404, 400 |
| POST | `/api/runs/<runId>/workspace` | `{"name"}` | **200** + state | 422, 404, 400 |
| POST | `/api/runs/<runId>/plan` | `{"plan":"free"\|"pro"}` | **200** + state | 404, 400 |
| POST | `/api/runs/<runId>/invite` | `{"email"}` | **200** + state | 422, 404, 400 |

What the error codes mean:
- **422 `{"errors":[...field names]}`:** the input broke a rule. Nothing was persisted. The fields are `name`, `email`, `password` and `consent` for signup, `name` for workspace, and `email` for invite. The rules match the app's inline errors.
- **404 `{"error":"run_not_found"}`:** the run was never initialized.
- **400 `{"error":"..."}`:** a bad run id, bad JSON, or a body with the wrong shape, such as a missing field or `"plan":"team"`.
- **413:** the body is over 16 kB.
- **405:** the method isn't allowed on that path.

State shape (`account` is `null` until signup, `plan` is `null` until chosen):

```json
{
  "runId": "run_demo_1",
  "createdAt": "…", "updatedAt": "…",
  "account": { "name": "Alex Kim", "email": "alex@northwind.test", "consent": true, "passwordLength": 13 },
  "workspaces": [{ "id": "ws_…", "name": "Northwind Sales", "createdAt": "…", "updatedAt": "…" }],
  "plan": "free",
  "paidTrialStarted": false,
  "invites": [{ "email": "jordan@northwind.test", "status": "sent", "at": "…" }]
}
```

### curl walkthrough

Run these against `npm run dev -w @ghostloop/prototype`:

```sh
B=http://localhost:5173/api/runs

curl -X POST $B/run_demo_1/init                                   # 201, empty state
curl $B/run_demo_1/state                                          # 200
curl -X POST $B/run_demo_1/signup -H 'content-type: application/json' \
  -d '{"name":"Alex Kim","email":"alex@northwind.test","password":"correct-horse","consent":true}'
curl -X POST $B/run_demo_1/workspace -H 'content-type: application/json' -d '{"name":"Northwind Sales"}'
curl -X POST $B/run_demo_1/plan -H 'content-type: application/json' -d '{"plan":"free"}'
curl -X POST $B/run_demo_1/invite -H 'content-type: application/json' -d '{"email":"jordan@"}'
#   → 422 {"errors":["email"]}, nothing stored
curl -X POST $B/run_demo_1/invite -H 'content-type: application/json' -d '{"email":"jordan@northwind.test"}'
curl -X DELETE $B/run_demo_1                                      # 204
curl $B/run_demo_1/state                                          # 404 {"error":"run_not_found"}
```

## `GHOSTLOOP_RUNS_DIR`

This variable sets where run state is stored.

- **Default:** `<repo>/.runs/`, which is gitignored.
- **When it's read:** the prototype server reads it at startup. Direct `checkGoal(runId)` calls (without `baseUrl` or `dir`) read it on every call.
- **Keep them in sync:** if a harness uses the direct form, set the same value for both the server and the harness, or pass `dir` explicitly. The `baseUrl` form avoids the question entirely.
- **Typical uses:** a temp directory per batch, to keep batches apart, or a fresh one per test. The prototype's Playwright e2e uses `$TMPDIR/ghostloop-e2e-runs`.

```sh
GHOSTLOOP_RUNS_DIR=/tmp/ghostloop-batch-7 npm run dev -w @ghostloop/prototype
```

State persists across server restarts. Writes go to a temp file and are then renamed into place, and the operations on any one run are serialized, so concurrent requests to the same run can't lose writes.

## Library API

These exports are mostly for tests and in-process use. The HTTP API is the normal integration point.
- `createRunStore(dir?)`: `init`, `get`, `update`, `remove`, plus `put`, a direct write that bypasses the rules and is used by tests to build states the app can't produce.
- `signup` / `saveWorkspace` / `choosePlan` / `sendInvite`: the server-side rules behind each endpoint.
- `createRunsApi({ dir })`: Connect-style middleware.
- `evaluateGoal(state)` and `GOAL_CHECKS`.
- `@ghostloop/prototype-adapter/validation`: browser-safe validation rules that the app shares, so client and server agree.

```sh
npm run check -w @ghostloop/prototype-adapter   # tsc + vitest
```
