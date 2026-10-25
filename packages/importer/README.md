# `@ghostloop/importer` — Import from Figma Make

This package handles imports. A designer uploads the **code ZIP exported from Figma Make**, and the app is built and previewed in a Docker
sandbox. The designer describes the task and its observable success checks, verifies and freezes them, then runs GhostLoop's
existing experiment loop on the imported app: baseline → Claude analysis → designer approval → separate candidate →
retest under the same frozen protocol.

> **Validation status.** No real Figma Make export was available while this was built. Everything was tested
> with `fixtures/northwind-make-export/`, a hand-written **compatibility fixture** shaped like a Make export. Validation
> against an actual Make export remains outstanding.

## Support boundary (MVP)

| Supported | Not supported |
| --- | --- |
| Frontend-only **React + Vite** apps, the shape Figma Make exports | Next.js, Remix, Vue, Svelte, Angular, Astro, React Native (rejected with the framework named) |
| ZIP up to **50 MB**, **200 MB** unzipped, **5000** entries, 25 MB per file | ZIP64, encrypted, spanned or non-UTF-8-named archives; symlinks; special files |
| One app, at the root or inside one wrapper folder, possibly nested (shallowest `package.json` next to `index.html`) | Several apps in one ZIP |
| `vite.config.{ts,mts,js,mjs,cjs}`, public npm dependencies, with or without `package-lock.json` | Private registries, packages that need install scripts (scripts are disabled) |
| Local app state (`useState`, `localStorage`, history routing) | Hosted backends: from previews, only same-origin requests and passive cross-origin assets (images, fonts, CSS, media) are allowed |
| Success decided by optional page checks (**route**, **visible text**, **visible control**, *all of*) — or, with none, by a Claude judge against the task description | Backend or email verification; arbitrary scripts; "any of" combinations |
| Candidate edits: **`set_label` on literal JSX text** under `src/**/*.tsx|jsx` (excluding `src/components/ui/`) | Style, layout, order or visibility changes; attribute text; text that appears more than once or contains HTML entities |

Changes are **not** written back to the Figma file. A code ZIP has no reliable mapping to Figma nodes. A Figma link
can be stored on the import for reference only.

## How it works

```
upload ─▶ validate ZIP ─▶ immutable source (sha256) ─▶ npm install ─▶ vite build ─▶ preview ─▶ task ─▶ verify ─▶ freeze
          (in memory)      .ghostloop/imports/sources   [container]    [container,     [container,
                                                                        no network]     127.0.0.1:47xxx]
```

- **Archive safety** (`zip.ts`, `archive.ts`). The ZIP is read in memory and nothing is extracted until it passes. The reader
  rejects absolute paths, drive letters, backslashes, `.`/`..`/empty segments, control characters, symlinks, special files,
  case-insensitive duplicates, files nested under files, and overlapping entries. Inflation stops at the declared size,
  so a lying header can't expand into a bomb, and CRCs are checked. `__MACOSX`/`.DS_Store` are dropped, and so are
  `node_modules`/`.git`, which are reinstalled fresh. One wrapper folder is stripped.
- **Immutable versions** (`store.ts`). The original upload is kept read-only. Each source version is a read-only,
  content-addressed tree whose hash is re-verified on every read. Version, frozen-task and candidate records are insert-only.
- **Sandbox** (`runtime/manager.ts`). Install, build and preview each run in their own container from
  `node:22-bookworm`, and every container is hardened:
  - runs as `--user 1000:1000` with `--cap-drop ALL` and `no-new-privileges`;
  - read-only root filesystem;
  - memory, CPU and PID limits, plus hard timeouts (install 6 min, build 4 min) and bounded logs.

  The steps differ in what they can reach:
  - **Install:** `npm install|ci --ignore-scripts` writes into a per-import Docker volume. It sees only the dependency files and has network access for the registry.
  - **Build:** `vite build --outDir /out --base /` runs with `--network none`.
  - **Preview:** GhostLoop's own static server (`runtime/preview-server.mjs`) serves the build read-only on a fixed loopback port per version (`127.0.0.1:47100-47999`). That port is a separate origin from the dashboard.

  No host files, credentials, environment or Docker socket are mounted. Containers carry `ghostloop.*` labels. The worker
  removes containers left by an earlier process at startup and its own containers on shutdown. Idle previews
  stop after 2 h (at most 6 run at once), and they restart on demand. If Docker is unavailable, the import fails with
  `RUNTIME_UNAVAILABLE` and setup instructions. **It never falls back to running on the host.**
- **Simulation** (`integration.ts`, plus simulator `discovery.ts`). Every trial gets a fresh browser context, with no storage carry-over,
  and starts at the frozen route and viewport. Controls are discovered from the rendered page as `role.label-slug`
  references. Each chosen reference is re-resolved and re-validated against the live page right before acting.
  Navigation must stay on the preview origin. CSS animations are disabled so observations settle.
- **Success: two modes, fixed per frozen task.**
  - **Judged (default, no checks).** The designer only describes the task. A separate Claude judge (`judge-v1`, the
    one the onboarding app uses) scores each finished trial from its actions, reasons and screenshots against the task
    as written; the integration contributes only the final page path as a fact. Results say *judged*, never
    *verified*, and Results warns that a wording change can sway a judge. A judged integration refuses to run without a
    judge (fail closed), and baseline/retest scored by different judges compare as inconclusive.
  - **Verified (with checks, `checks.ts`).** Only the frozen checks decide `goal`. GhostLoop evaluates them on the final page after every action,
  and no judge model is used. The agent saying it is done counts as `agent_stop`, not success. A check that fails to evaluate is
  an infrastructure error, never success. Checks are **UI evidence**: a visible confirmation is not proof that a backend did anything.
- **Check suggestions** (`suggest.ts`, Claude adapter in the optimizer). "Suggest checks" sends the task, the starting
  page (text, controls, screenshot), the app's literal texts and the route literals found in its source to Claude.
  Code keeps at most three proposals: valid checks grounded in the app's own text or routes, not the starting route,
  and not already true on the starting page; the rest are listed with the reason. Nothing is saved until the designer
  adds a suggestion (about $0.02 per request).
- **Freezing** (`task.ts`). The verified task is stored as `tasks/<sha256>.json`, outside every source tree, and the protocol
  carries `hiddenGoalRef: "import-task:<sha256>"`. The baseline and every retest load it by hash, and an edited file is
  refused. Freezing requires a verification of the same task, and verification refuses checks that already pass at the start.
- **Candidates** (`manifest.ts`, `patch.ts`, `service.ts`). The manifest lists each literal JSX text with its file, offsets,
  line, tag and file hash. Text used by a success check or listed by the designer as protected goes into the protocol's
  `protectedElements`. A patch is applied only if all of the following hold:
  - it is `approved` and not blocked;
  - it is `set_label` and targets an editable element of exactly that source version;
  - the file still hashes to what the manifest recorded and the recorded text is still at its offsets;
  - the new text is plain (no `{}<>&`, one line, ≤200 chars).

  The result is a **new** immutable version with its own build and preview. The original is never touched.
- **Candidate validation.** `build`, `start_route_renders` (runnable); `only_approved_text_changed` (the approved patches
  are re-applied to the parent and must match byte for byte), `protected_text_unchanged`, `success_checks_unchanged`,
  `structure_preserved` (same controls by role at the start route), `checks_not_satisfied_at_start` and
  `approved_text_rendered` (guardrails). A failed runnable check stops the experiment (`INTEGRATION_FAILURE`). A failed guardrail
  gives a rejected evaluation (`NO_VALID_PATCH`). Either way the original stays the incumbent.

## Commands

From the repository root:

```sh
nvm use && npm install
npx playwright install chromium                       # or set SIMULATOR_BROWSER_CHANNEL=chrome
npm run check -w @ghostloop/importer                  # tsc + unit/browser tests (no Docker, no model calls)
GHOSTLOOP_DOCKER_TEST=1 npm test -w @ghostloop/importer -- docker.live   # real containers + npm registry + Chromium
npm run fixture:zip -w @ghostloop/importer           # packs the compatibility fixture into fixtures/northwind-make-export.zip
```

Running the whole product: `./demo.sh` from the repository root starts (or reuses) everything below and stops what
it started on Ctrl+C; `./demo.sh --e2e 6` also runs the scripted dashboard walkthrough. By hand (four terminals):

```sh
npm run stdb:start                                    # 1: SpacetimeDB on :3000 (then once: npm run stdb:publish)
npm run worker:real                                   # 2: worker; imports are on by default (API on 127.0.0.1:5180)
npm run dev -w @ghostloop/dashboard                   # 3: dashboard on :5174 → "Import app"
npm run dev -w @ghostloop/prototype                   # 4: only needed for the onboarding app
```

A scripted UI walkthrough uses live model calls:
`SIMULATOR_BROWSER_CHANNEL=chrome npx tsx packages/importer/scripts/dashboard-e2e.ts packages/importer/fixtures/northwind-make-export.zip /tmp/e2e 3`.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `BITDEER_API_KEY`, `BITDEER_MODEL`, `BITDEER_BASE_URL` | — | The simulated user's model (required for real trials) |
| `ANTHROPIC_API_KEY` | — | Claude analysis that proposes text changes |
| `GHOSTLOOP_IMPORT_PORT` | `5180` | Worker's import API port (loopback only) |
| `GHOSTLOOP_IMPORT_API_URL` | `http://127.0.0.1:5180` | Where the dashboard proxies `/api/imports*` |
| `GHOSTLOOP_IMPORT_IMAGE` | `node:22-bookworm` | Sandbox base image; must provide node/npm and uid 1000 |
| `GHOSTLOOP_DOCKER_BIN` | `docker` | Docker CLI to use |
| `SIMULATOR_BROWSER_CHANNEL` | bundled Chromium | `chrome` to use installed Chrome |

`npm run worker -- --imports off` disables imports. Imported versions always use the real simulator: mock fixtures never
stand in for an imported app's results. With `--analysis mock`, imported experiments stop with `NO_VALID_PATCH`, because the mock
model only knows onboarding elements.

## HTTP API (worker, `127.0.0.1:5180`)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/import-runtime` | Sandbox availability and setup hint |
| `GET` / `POST` | `/api/imports` | List imports / upload (`Content-Type: application/zip`, `?name=&figmaUrl=&fileName=`) |
| `GET` | `/api/imports/:id` | Status, report, error (code, hint, log tail), preview URL |
| `POST` | `/api/imports/:id/cancel` · `/retry` | Cancel an import in progress · retry a failed/cancelled one from the stored upload |
| `PUT` | `/api/imports/:id/task` | Save the task draft (validated) |
| `POST` | `/api/imports/:id/suggest-checks` | Propose grounded success checks for `{task, startRoute, viewport}` (not saved) |
| `POST` | `/api/imports/:id/verify` · `/freeze` | Verify against the preview · freeze the verified task |
| `POST` | `/api/imports/:id/experiments` | Create and start a baseline under the frozen task |
| `GET` | `/api/imports/:id/log?step=install\|build&version=` | Sandbox log |
| `GET` | `/api/import-versions/:versionId` | Manifest with source locations, build state, preview URL |

Requests that carry an `Origin` header must come from the dashboard origin. JSON endpoints require a JSON content type.

## Known limitations

- Validated only against the compatibility fixture, not yet a real Make export.
- The first install of a dependency set needs network access to the npm registry, and later ones reuse a per-import volume.
  Install scripts are skipped, so packages that require them will fail to build (the log says so).
- Controls are discovered only inside the viewport; scrolling, iframes, shadow DOM and multi-select are out of scope,
  the same as the onboarding simulator.
- Judged results are weaker evidence than checks: the judge is a model, it costs about $0.03–0.05 per trial, and the
  wording changes GhostLoop tests can influence it. Add checks (or accept suggested ones) when it matters.
- Success checks are UI evidence only. Apps that render a confirmation without a real backend will "succeed".
- One narrow edit class (literal JSX text). The edit isn't previewed before approval because building takes ~10–20 s.
  The candidate is previewed on Results after it is built.
- Stopping the worker with a hard kill can leave preview containers, which the next start removes. Dependency volumes
  (`gl-deps-*`, labeled `ghostloop.managed=1`) persist as a cache: `docker volume prune --filter label=ghostloop.managed=1`.
