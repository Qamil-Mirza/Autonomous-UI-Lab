# B ↔ C prototype handoff

## Implemented on B's side

- Viewport: 1280×800 **CSS pixels**. Bounds and pointer positions remain CSS pixels.
- Screenshots use `scale: 'css'`, so exported PNGs are also 1280×800 even at device scale factor 2. A/Hanna must not multiply coordinates by the Retina scale factor. When displaying a screenshot at a different size, apply only the display-size/1280 ratio (and corresponding height ratio).
- Target real controls using `getByTestId(elementId)`, including dotted IDs. Consent checkboxes support click actions. The practice page's older `data-agent-id` remains supported.
- Only visible, enabled, unobscured DOM controls on the current screen AND in the version registry are exposed. Static text/decorations are not action targets, even if they have a test ID.
- Read `/designs/versions/<versionId>.json`. Accept wire IDs named `id` or `elementId`; require the correct `versionId`. Public registry objects retain only `elementId`, `screen`, `role`, and `label`. DOM observation supplies enabled status, available actions, options and bounds. Protected flags and mutation metadata never enter the prompt.
- Generate a unique `run_...` ID; POST `/api/runs/<runId>/init` before opening `/v/<versionId>/signup?run=<runId>`.
- Permit same-version signup/workspace/plan/invite/confirm navigation only with that same run ID. Permit local assets and the current run's API requests; reject other runs and external origins.
- Invoke C's trusted `checkGoal(runId)` after actions and at termination. Validate its result and matching run ID. Record it in `goal-check.json` before cleanup.
- DELETE `/api/runs/<runId>` on success or failure, including partial initialization. Report cleanup errors in metadata rather than silently discarding them.
- Record visible `role="alert"` content in `feedback.jsonl`; classify that action as `validation_error`. The model also sees the resulting screenshot.

## Shared types and ownership

`packages/contracts/src/prototype.ts` exports `ControlRegistryEntry`, `ControlRegistry`,
`GoalCheckResult`, and the `PrototypeGoalAdapter` interface. These are additive
contracts. C implements the checker in `packages/prototype-adapter`; B invokes it.
The checker implementation and results are not model inputs.

The proposed result shape is supported:

```ts
{
  runId,
  achieved,
  checks: [{ name, passed, detail }],
  at // ISO timestamp
}
```

Checks must be nonempty, uniquely named, and `achieved` must equal whether all
checks passed. C's implementation must supply every required domain check:
account created, exactly one workspace, Free plan selected, exactly one valid
invitation sent, and no paid trial. B must not infer these from screen headings.
C's GET `/api/runs/<runId>/state` is for the trusted checker; B does not guess its
state schema or send it to the model.

## Current element naming

`manifest.base.json` is now a synthetic description of `ver_baseline`, containing:

- `workspace.continue`, `invite.send` (Send invite), `confirm.title` on screen `confirm`.
- `plan.free.cta`: Continue; `plan.pro.cta`: Start free trial.
- `plan.pro.price`: $12 / user / month.
- New `signup.name` (Full name), `invite.error` (alert), `confirm.done` (Go to dashboard).
- `plan.free.note` (No card required), static text, hidden initially, supports `set_visibility` and `set_label`.
- Existing signup/consent/workspace/plan/invite field IDs are preserved.

`plan.free.note` is a suitable optional visibility-patch target. It is not a clickable
replacement for the old comparison link. The old metric fixtures have a comparison
screen and optional invitations; their original `ver_base0001` manifest is now
`manifest.legacy.json`. Those historical synthetic fixtures were deliberately not
rewritten to pretend they are real `ver_baseline` trajectories. D should use the
legacy manifest with that old dataset, and current manifests with fresh runs.

## Candidate failures

The existing `CandidateAdapter.createCandidate` returns `Promise<CandidateDesign>`.
Keep that signature: on blocked or stale patches, reject/throw before applying any
mutation; do not return a partial candidate or `{ok:false}` through that signature.
Use machine-readable error codes (recommended `PATCH_BLOCKED` and
`STALE_SOURCE_VERSION`) agreed with D. The current D contract treats adapter
rejection as an integration failure and does not parse error text. More specific
recovery requires an explicit shared error contract with D.

## Run against C's implementation

After C's app and trusted adapter are present:

```sh
# Terminal 1, from repository root
npm run dev -w @ghostloop/prototype

# Terminal 2, from repository root; substitute C's actual module filename
npm run demo -w @ghostloop/simulator -- \
  --prototype-url http://localhost:5173 \
  --version ver_baseline \
  --goal-adapter "$PWD/packages/prototype-adapter/src/index.ts" \
  --max-actions 16 --headed
```

The supplied local module must export `checkGoal(runId)` and configure its own
trusted state access. The adapter module is trusted developer code, never model
output. Prototype mode uses fictional account inputs and a 16-action default;
practice mode still defaults to six. `--mock` remains practice-only.

## Verification and outstanding integration

Automated tests exercise a local stub of C's API, run IDs in URLs and saves,
registry redaction, dotted test IDs, consent clicks, wrong-run rejection, cleanup,
and 1280×800 PNGs at Retina device scale factor 2. This does not verify C's app.

C's app and prototype adapter are now merged. The simulator passes
`{ baseUrl: prototypeUrl }` to C's `checkGoal` so state is read over HTTP from
the same server. A live Bitdeer run on October 24, 2026 completed all five trusted
checks in 10 actions (run_d08aa880-80f3-409f-a7ec-6dec3930037c).

The Pro-trial failure, Back/update isolation, and invalid-email recovery have
separate website tests. The live model baseline run followed the happy path;
model-driven recovery scenarios and candidate retests remain future work.


Observation adapter completion: every new captured screenshot now has a matching
`.png.observation.json` with the exact URL, screen, CSS viewport/scroll offset,
public controls (including native types and bounds), and alerts. Snapshot controls
are passed alongside that exact screenshot. Protected flags and checker results
remain excluded. A browser test exercises all five screens of C's real website
with scripted actions, including invalid-email correction, without model calls.
