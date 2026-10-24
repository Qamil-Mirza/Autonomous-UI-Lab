# @ghostloop/prototype

React + Vite prototype of the Matrix Coor onboarding flow (Figma page "01 Baseline A"). It is designed at 1280×800 and fills larger viewports: the nav and gradient span the full width, the card stays centered below the nav, and `decor.sparkle` is anchored bottom-left and scales with the viewport height (exactly 630×783 at 800 px tall).

From the repo root:

```sh
npm install
npm run dev -w @ghostloop/prototype       # http://localhost:5173 → /v/ver_baseline/signup
npm run build -w @ghostloop/prototype
npm run preview -w @ghostloop/prototype   # serves dist/ on http://localhost:4173
npm run check -w @ghostloop/prototype     # typecheck
npm run e2e -w @ghostloop/prototype       # Playwright end-to-end tests (see below)
```

Both `dev` and `preview` serve the app, the design manifests (`/designs`), the run API (`/api/runs`) and the Figma mapping API (`/api/figma/:versionId`) on one port.

## Runs and goal checking (for harnesses)

Every screen submit is sent to the run-scoped API from `@ghostloop/prototype-adapter`. The screen advances only when the server accepts the submit. State is stored per run in `GHOSTLOOP_RUNS_DIR`, which defaults to the gitignored `<repo>/.runs/`, and it survives server restarts.

- **Harness use.** Initialize a run, then open the app with it:
  ```sh
  curl -X POST http://localhost:5173/api/runs/run_abc123/init
  open "http://localhost:5173/v/ver_baseline/signup?run=run_abc123"
  ```
  The app keeps `?run=` on every navigation, including the Back links. It never initializes an id it was given, so a harness must call `init` first.
- **Manual use.** Without `?run=`, the app creates a `run_manual_<12 hex>` run, initializes it and adds it to the URL.
- **An invalid `?run=`** shows an error panel (`data-testid="run-error"`).
- **Goal check.** Call `checkGoal(runId, { baseUrl: "http://localhost:5173" })` from `@ghostloop/prototype-adapter`. It reads only the run's stored state, never the screen.

`packages/prototype-adapter/README.md` documents the full harness recipe, every endpoint with curl examples, the five goal checks and `GHOSTLOOP_RUNS_DIR`.

## Figma mappings

`GET /api/figma/:versionId` returns the version's Figma mapping (frame URL, `verified`/`mismatch` status, manifest hash, patch IDs and per-element checks), `{ versionId, status: "pending" }` if none exists yet, or 404 for an unknown version. See `packages/prototype-adapter/README.md` for the fields and `docs/figma-variant-workflow.md` for how mappings are made.

## Routes

`/v/:versionId/{signup,workspace,plan,invite,confirm}?run=<runId>`. The version's manifest is fetched at runtime from `/designs/versions/<versionId>.json` and validated with `parseManifest` from `@ghostloop/design-engine`. An unknown, malformed or incomplete version shows an error panel (`data-testid="manifest-error"`).

## Manifests are served, not bundled

The Vite config serves the designs directory (`GHOSTLOOP_DESIGNS_DIR`, default the repo-root `designs/`) at `/designs` with `Cache-Control: no-store`, in both `vite` (dev) and `vite preview`. A new candidate file such as `designs/versions/ver_abc.json` loads at `/v/ver_abc/signup` without a rebuild. Any other host for `dist/` must also serve `designs/` at `/designs`.

Candidate versions written there by the `CandidateAdapter` (`@ghostloop/prototype-adapter`) are gitignored. Only `ver_baseline.json` is committed.

## Render groups

Each `<Ordered group="…">` block renders the elements of one render group from `@ghostloop/design-engine`'s `RENDER_GROUPS` in manifest order. `set_order` patches can only move an element within its group. If a block's children don't match its group exactly, the block throws.

## Control IDs

Every Figma layer whose name contains a dot is rendered with `data-testid` equal to that name. On inputs and checkboxes, the testid is on the native control. Its label, style token, order and visibility come from the manifest. `decor.sparkle` is `aria-hidden` and ignores pointer events. The nav avatar is decorative and not interactive.

Behaviour:
- Validation is re-checked on every submit. Failures show inline (`role="alert"`, protected) and clear when that field is edited.
  - signup: name required (`signup.name.error`), valid email (`signup.email.error`), password of at least 8 characters (`signup.password.error`), consent checked (`signup.consent.error`).
  - workspace: name required (`workspace.name.error`).
  - invite: valid email (`invite.error`).
  - The server applies the same rules. If it rejects a field (422), the same inline error appears.
- If a submit fails for any other reason, such as the server being unreachable, the run not being initialized, or a 5xx, the screen stays put. A generic alert, "Something went wrong. Try again." (`data-testid="api-error"`, `role="alert"`), then appears just below the card. It is not a manifest control. A second click while a submit is in flight is ignored.
- **Workspace** saves the run's single workspace. Going Back and resubmitting renames it and never creates a second one.
- **Plan:** choosing Pro (`plan.pro.cta`) starts a paid trial server-side. The trial stays recorded even if the user goes Back and picks Free.
- **Invite** sends through a simulated invite service. Only a valid address is recorded as sent.
- `workspace.back`, `plan.back` and `invite.back` follow the Figma design: "←Back" just above the card (above the free plan card on plan). The arrow is decorative; the manifest label is the link text. They return to the previous screen. Entered values, including consent, are kept in memory for the session, so they are pre-filled on the way back. Signup and confirm have no back link.
- `confirm.done` ends the flow; there's no dashboard yet.

## End-to-end tests

```sh
npx playwright install chromium            # once, if the browsers aren't installed
npm run e2e -w @ghostloop/prototype
```

`playwright.config.ts` starts its own Vite server on port 5174. It sets `GHOSTLOOP_RUNS_DIR` to `$TMPDIR/ghostloop-e2e-runs` and `GHOSTLOOP_DESIGNS_DIR` to a fresh `$TMPDIR/ghostloop-e2e-designs` holding only the baseline, so it never touches `.runs/` or `designs/`. It runs at 1280×800. The specs in `e2e/onboarding.spec.ts` cover:
- The Free happy path, where `checkGoal` reports `achieved: true`.
- Choosing Pro, where `free_plan_selected` and `no_paid_trial` fail.
- Back + resubmit, which keeps one workspace and keeps `?run=`.
- Auto-creating a `run_manual_*` run.
- The `api-error` alert for an uninitialized run.

`e2e/candidates.spec.ts` drives the real `CandidateAdapter`:
- A valid candidate passes every check, and its patch is live in the app.
- Tampered candidates fail exactly the matching check:
  - a protected price fails `protected_elements_unchanged`
  - an empty button label fails `accessible_labels`
  - a hidden Free button fails `onboarding_smoke`

The e2e tests are not part of `check` because they need browsers and a server.
