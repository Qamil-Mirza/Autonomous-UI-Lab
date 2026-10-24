# @ghostloop/prototype-adapter

Run-isolated application state for the Matrix Coor onboarding prototype (`apps/prototype`), the simulated invite service, the trusted goal checker, and the `CandidateAdapter` that builds and validates patched design versions (see [CandidateAdapter](#candidateadapter-for-ds-controller)).

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

## CandidateAdapter (for D's controller)

`createCandidateAdapter` is the real implementation of the contract's `CandidateAdapter`. It replaces `workers/optimizer/src/mocks/candidates.ts`.

```ts
import { createCandidateAdapter } from "@ghostloop/prototype-adapter";

const candidates = createCandidateAdapter({
  baseUrl: "http://localhost:5173",  // where the prototype runs: candidate URLs + browser checks
  // designsDir: "/path/to/designs", // default: GHOSTLOOP_DESIGNS_DIR, then <repo>/designs
});

const cand = await candidates.createCandidate("ver_baseline", approvedPatches);
const validation = await candidates.validateCandidate(cand.id);
const manifest = await candidates.getManifest(cand.versionId);
```

### Methods

**`createCandidate(sourceVersionId, approvedPatches) → CandidateDesign`**
1. Loads `designs/versions/<sourceVersionId>.json`.
2. Applies the patches with `applyPatches` from `@ghostloop/design-engine/patch`. Its rules are in the design-engine README.
3. Writes the result as a new, immutable version, `designs/versions/<newVersionId>.json`.
4. Writes a candidate record, `designs/candidates/<cand_id>.json`. It holds the `CandidateDesign`, the exact patches and the parent's manifest hash.

Both files are created **exclusively**, so an existing file is never overwritten; a collision throws `EEXIST`. The source version, including `ver_baseline`, is never modified.

The returned candidate:
- Its `patchIds` are exactly the approved IDs, in order.
- `parentVersionId` is `sourceVersionId`.
- `url` is `<baseUrl>/v/<versionId>/signup`.
- `reviewStatus` is `"pending"`.
- `figma` is omitted for now.

A subset of patches always produces its own distinct candidate and version.

**`getManifest(versionId) → DesignManifest`**
- Returns that version's manifest; its `versionId` is always the one requested.
- The manifest is a contract `DesignManifest` plus the presentation fields: `styleToken`, `order`, `visible` and `patchIds`.

**`validateCandidate(candidateId) → ValidationResult`**
- Returns every check below.
- `ok` is true only when every check passes.
- Each check has a factual `detail`. Failed checks always have one.

| Check | Kind | Passes when |
|---|---|---|
| `build` | runnable | The candidate file parses against the contract and the presented schema, and its `versionId`, `parentVersionId` and `manifestHash` are consistent. |
| `renders_all_screens` | runnable | Headless Chromium at 1280×800, on a fresh run, loads all 5 screens of the candidate. No error panel appears. Every visible manifest element is present by `data-testid` and every hidden one is absent. Alerts are checked by triggering them. |
| `onboarding_smoke` | runnable | On a fresh `run_validate_*` run, a scripted Free happy path completes and `checkGoal` returns `achieved: true`. On failure, the detail names the step that broke. |
| `protected_elements_unchanged` | guardrail | Every element protected in the parent is identical: label, visibility, order, style token, and protection metadata. |
| `manifest_ids_stable` | guardrail | The element ID set is the same as the parent's. |
| `checker_unchanged` | guardrail | The goal checker's check list and its verdicts on 4 reference states match the pinned values, and no `checker`-category element changed. The checker reads only run state, never a manifest. |
| `style_tokens_approved` | guardrail | Every style token is an approved `StyleToken`. |
| `accessible_labels` | guardrail | Every visible control (button, textbox, checkbox or link) has a non-empty accessible name and is keyboard-focusable. |

- **Server required:** the browser checks need the prototype running at `baseUrl`, serving the same designs directory.
- **Server unreachable:** if it isn't running, `renders_all_screens`, `onboarding_smoke` and `accessible_labels` fail with `app server not reachable at <baseUrl>: ECONNREFUSED`. Nothing throws. A browser that won't launch is reported the same way.
- **Raw-file guardrails:** the guardrails read the raw candidate file, so they still report facts when it no longer parses.

### What throws, and how D handles it today

Every error the adapter can throw is listed below:
- **`PatchError`:** has a stable `code`, plus `patchId` and `name === "PatchError"`. It is thrown only by `createCandidate`, before anything is written.
- **Other adapter errors:** plain `Error`s with no `code` field. Each is identified by its message. The exceptions are Node's file-system errors, which carry their usual `err.code` (for example `EEXIST`), and zod's `ZodError`.

`validateCandidate` never throws for a bad candidate. Build, render, smoke and guardrail problems all come back as failed checks.

| Thrown by | Identify by | Meaning |
|---|---|---|
| `createCandidate` | `PatchError` `code: "invalid_patch"` | A patch doesn't match the contract's `MutationPatch` schema, e.g. a missing field or a bad `pat_` id. |
| `createCandidate` | `PatchError` `code: "invalid_value"` | The value is wrong for its op. Examples: a non-boolean visibility, a blank label or one over 120 characters, an unapproved style token, an order outside the render group's slots, or a reorder that moves a protected element or changes the workflow order. |
| `createCandidate` | `PatchError` `code: "stale_source"` | `patch.sourceVersionId` isn't the version being patched. |
| `createCandidate` | `PatchError` `code: "not_applicable"` | The patch has `risk: "blocked"` or `state: "blocked"`/`"declined"`. |
| `createCandidate` | `PatchError` `code: "unknown_element"` | The source manifest has no element with `targetElementId`. |
| `createCandidate` | `PatchError` `code: "protected_element"` | The target is protected. The message names its categories, e.g. `(pricing)`. |
| `createCandidate` | `PatchError` `code: "unsupported_op"` | The op isn't in the target's `supportedOps`. |
| `createCandidate` | `PatchError` `code: "conflict"` | Two patches apply the same op to the same element, or two patches share an ID. |
| all three | `Error`, message `invalid versionId "…"` / `invalid candidateId "…"` | The ID doesn't match `^ver_[A-Za-z0-9_-]+$` / `^cand_[A-Za-z0-9_-]+$`. It is never used as a path. |
| `createCandidate`, `getManifest` | `Error`, message `design version <id> not found (…)` | There is no `versions/<id>.json` in the designs dir. |
| `validateCandidate` | `Error`, message `candidate <id> not found (…)` | There is no `candidates/<id>.json` in the designs dir. |
| `createCandidate`, `getManifest` | `Error`, message `versions/<id>.json declares versionId <other>` | The version file's `versionId` doesn't match its file name. |
| `createCandidate`, `getManifest`, `validateCandidate` | `SyntaxError` | The version or candidate file isn't valid JSON. |
| `createCandidate`, `getManifest` | `ZodError` | The version file fails the contract or presented-manifest schema. |
| `validateCandidate` | `ZodError` | The candidate record fails the `CandidateRecord` schema. |
| `createCandidate` | `ZodError` | The candidate fails `CandidateDesign`. In practice this only happens when `baseUrl` isn't a valid URL. |
| `createCandidate` | Node error `code: "EEXIST"` | The new version or candidate file already exists. Exclusive create means nothing was overwritten. If the record collides, the new version file is removed. |
| any | Node error `code: "EACCES"`, `"ENOSPC"`, etc. | Some other file-system failure reading or writing the designs dir. |

**Current behavior in D's controller** (`workers/optimizer/src/controller/context.ts`, `adapter()`):
- **Throws:** any throw from these methods is wrapped as an `IntegrationError`. The experiment stops with **`INTEGRATION_FAILURE`**, or `USER_STOP` if a cancel is pending. The incumbent version is preserved, and the error message is recorded in the transition note but never interpreted.
- **Failed checks:** for `validateCandidate` results, a failed runnable check also stops with `INTEGRATION_FAILURE`. A failed guardrail gives a rejected evaluation and `NO_VALID_PATCH`.
- **Possible future mapping (for Qamil to decide):** a `PatchError` from `createCandidate` could map to `NO_VALID_PATCH` instead of `INTEGRATION_FAILURE`, using `err.name === "PatchError"` or `err.code`. This is not implemented; today every throw is an integration failure.

### Files and `GHOSTLOOP_DESIGNS_DIR`

```
designs/
  versions/ver_baseline.json        # committed original design
  versions/ver_<id>.json            # generated candidates (gitignored)
  candidates/cand_<id>.json         # candidate records (gitignored)
  figma/ver_baseline.json           # committed Figma mapping of the baseline
  figma/ver_<id>.json               # candidate Figma mappings (gitignored)
```

- **Default location:** `GHOSTLOOP_DESIGNS_DIR`, default `<repo>/designs`.
- **Shared with the server:** the prototype's Vite server serves this same directory at `/designs` (it reads the variable at startup). New candidates load immediately, without a rebuild. Set the same value for both, or pass `designsDir` explicitly.
- **e2e isolation:** the Playwright tests use `$TMPDIR/ghostloop-e2e-designs`.

### Demo

```sh
npm run dev -w @ghostloop/prototype                 # terminal 1
npm run candidate:demo -w @ghostloop/prototype-adapter   # terminal 2 (GHOSTLOOP_BASE_URL to point elsewhere)
```

The demo works like this:
1. It creates candidate **B** from `ver_baseline` with one approved patch: `set_label plan.free.cta → "Continue with Free plan"`.
2. It creates candidate **C** with that patch plus `set_visibility plan.free.note → true`.
3. It validates both.
4. It prints each candidate, its URL and its check table.
5. It confirms `ver_baseline.json` is byte-identical before and after.

It exits non-zero if either validation fails or the baseline changed.

## Figma mappings

Each design version can have a Figma mapping, `designs/figma/<versionId>.json`, written by the Figma variant workflow (`docs/figma-variant-workflow.md`). `FigmaMapping` is the contract's `FigmaReference` (`frameUrl`, `status`, `manifestHash`, `patchIds`) extended with:

| Field | Contents |
|---|---|
| `versionId`, `parentVersionId` | The version and its parent (`null` for the baseline). |
| `fileKey`, `frames` | The Figma file and the `{ screen, nodeId, name }` frames that were checked. |
| `checks` | Every per-element check: `{ elementId, screen, frame, kind, field, expected, actual, passed, note? }`. |
| `checkedAt`, `method` | When the frames were read back, and `"Claude Code via Figma MCP, designer-triggered"`. |

`status` is `verified` when every check passed, and `mismatch` otherwise. For `ver_baseline`, `frameUrl` is the "01 Baseline A" page; for a candidate, it's the variant frame. Only `designs/figma/ver_baseline.json` is committed.

### `GET /api/figma/:versionId`

Served by the prototype's Vite server (dev and preview), from `createFigmaApi({ designsDir })`. Every response is `no-store`.

| Request | Response |
|---|---|
| A mapping exists | 200 with the mapping |
| A known version with no mapping | 200 `{ "versionId": "...", "status": "pending" }` |
| No `designs/versions/<versionId>.json` | 404 `{ "error": "version_not_found" }` |
| An ID not matching `^ver_[A-Za-z0-9_-]+$` | 400 |
| A corrupt mapping file | 500 with an `error` message |

```sh
curl http://localhost:5173/api/figma/ver_baseline
# → {"frameUrl":"https://www.figma.com/design/hUYlyMbzUB2LnefdcudZOb/Calhacks-13.0?node-id=15-122","status":"verified",...}
```

### Writing a mapping

```sh
npm run figma:mapping -w @ghostloop/prototype-adapter -- --version <versionId> --snapshot <variant.json> \
  --baseline-snapshot <baseline.json> --frame-url <variant frame URL>
```

The snapshots are `figma/snapshot.js` read-backs (see `@ghostloop/design-engine`). `--baseline-snapshot` is required for a candidate and omitted for an original design. The script prints the status and every failed check, and overwrites any earlier mapping.

## Library API

These exports are mostly for tests and in-process use. The HTTP API is the normal integration point.
- `createRunStore(dir?)`: `init`, `get`, `update`, `remove`, plus `put`, a direct write that bypasses the rules and is used by tests to build states the app can't produce.
- `signup` / `saveWorkspace` / `choosePlan` / `sendInvite`: the server-side rules behind each endpoint.
- `createRunsApi({ dir })`: Connect-style middleware.
- `evaluateGoal(state)` and `GOAL_CHECKS`.
- `createCandidateAdapter`, `CandidateRecord`, `defaultDesignsDir()`.
- `FigmaMapping`, `buildFigmaMapping`, `writeFigmaMapping`, `createFigmaApi({ designsDir })`.
- `@ghostloop/prototype-adapter/validation`: browser-safe validation rules that the app shares, so client and server agree.

```sh
npm run check -w @ghostloop/prototype-adapter   # tsc + vitest
```
