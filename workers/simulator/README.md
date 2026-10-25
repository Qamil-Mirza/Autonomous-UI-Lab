# Part B: single-user practice simulator

Runs a real browser against a tiny local workspace form. In live mode Bitdeer sees
screenshots, the task, observed controls, prior actions, and the remaining budget.
It chooses an action; the worker validates and executes it. Success requires
exactly one workspace named `Demo` in the fixture's actual session state.

This supports single runs, including Group C's signup/Free-plan/invite flow via
prototype mode. A bounded batch adapter and CLI are also available (see below). The Python screenshot smoke test remains
available separately.

## Setup

Use Node.js 22 or newer. From the repository root:

```sh
npm install
npx playwright install chromium
```

In the root `.env` (existing shell variables take precedence):

```dotenv
BITDEER_API_KEY=your-key
BITDEER_BASE_URL=https://api-inference.bitdeer.ai/v1
BITDEER_MODEL=Qwen/Qwen3.8-27B
BITDEER_TIMEOUT_MS=60000
# Optional: use installed Google Chrome instead of downloaded Chromium
SIMULATOR_BROWSER_CHANNEL=chrome
```

The key stays in the worker, never the webpage or recorded trace. Live mode sends
screenshots of this fictional practice page to Bitdeer and consumes API credits.
A 402 ends the run as `model_error` with a credit-allocation message.

## Run

From the repository root:

For this machine, the verified run used temporary Node and Chromium downloads.
If `node`/`npm` are not on your PATH, use these in your terminal first:

```sh
export PATH="/tmp/node-v22.23.4-darwin-arm64/bin:$PATH"
export PLAYWRIGHT_BROWSERS_PATH=/tmp/ghostloop-playwright
```

These `/tmp` downloads may be cleared; the setup instructions above are the
portable path once Node 22+ is installed.

```sh
# Live model decisions; real browser; local practice server starts automatically
npm run demo -w @ghostloop/simulator

# Show the browser window
npm run demo -w @ghostloop/simulator -- --headed

# No API calls: deterministic mock decisions, real browser
npm run demo -w @ghostloop/simulator -- --mock

# Check the action-budget outcome
npm run demo -w @ghostloop/simulator -- --mock --max-actions 1
```

The CLI returns exit status 0 only for verified success. Non-success runs still
write their results. Ctrl+C cancels and preserves completed events. Runs are capped
at six actions by default (configurable 1–20), the configured timeout per model request (60 seconds by default), and
four minutes overall. Each decision allows at most three model requests (the first
request plus two retries), with cancellable 250/500 ms backoff. Invalid responses
never reach the browser. HTTP 402 and other permanent errors stop immediately.

## Artifacts

Each run writes an ignored directory under `workers/simulator/artifacts/run_.../`:

- `run.json`: validated shared `AgentRunResult`, including outcome and verified goal.
- `events.jsonl`: ordered completed actions, appended as the run progresses.
- `decision-attempts.jsonl`: accepted/rejected model attempts, step, feedback and retry flag. Rejected attempts are not executed actions.
- `000.png`, `001.png`, etc.: initial screenshot and screenshots after each action.
- `000.png.observation.json`, etc.: matching URL, screen, CSS viewport, scroll offset, control inventory and visible alerts.
- `metadata.json`: live/mock provenance, model, decision-call count, and any error.

Screenshot references are absolute local paths, suitable for this local demo.
Publishing artifacts requires uploading the images and replacing those references.
Mock runs are explicitly labeled; they are not evidence of AI performance.

Verified live run on October 24, 2026:
`run_5d4301c7-943d-4f85-b837-5084a9a09a70` used `Qwen/Qwen3.8-27B`, performed
two actions (fill `Demo`, click Create workspace), and finished with `goalVerified:
true`. Three screenshots and the schema-validated trace are in its local artifact
directory. These generated files are intentionally ignored by git.

## Checks

```sh
npm run check -w @ghostloop/simulator
npm run test -w @ghostloop/simulator
```

Tests use real Chromium with mock decisions and no model charges. They exercise
action validation, verified completion, isolation, false model success claims,
step exhaustion, model/browser errors, and cancellation with partial evidence.

## Integration with C and D

- C: integrated the stable `data-testid` registry, isolated run state, trusted onboarding checker and version/run route allowlist.
- D: retain the existing shared contract types; add the actual experiment/version/scenario IDs.
- D: use `createSimulationAdapter` for bounded batches and pass the event sink callback.
- A/D: connect artifact storage and replay to the returned screenshot references.

Current observation supports visible, enabled inputs, textareas, buttons, and
selects fully inside the viewport. Scrolling and arbitrary sites are not implemented. Provider billing is unknown unless a per-call estimate is configured.
No model-generated code is executed. The checker and its implementation never
enter the model prompt.

## Prototype handoff mode

See [PROTOTYPE-HANDOFF.md](PROTOTYPE-HANDOFF.md) for the run-scoped API integration,
trusted goal-adapter loading, current element names, CSS-pixel coordinate rules,
and the exact command to run against C's app when it becomes available.

Prototype mode supports `data-testid`, dotted IDs and consent checkboxes, records
visible validation alerts, and uses 1280×800 CSS-scaled screenshots. Its run state
is initialized before navigation and deleted on exit. Practice mode remains available.

References: [Playwright contexts](https://playwright.dev/docs/api/class-browsercontext),
[Bitdeer vision](https://developers.bitdeer.ai/docs/guides/llm/vision).


## Validated Bitdeer configuration

The TypeScript worker reads `BITDEER_API_KEY`, `BITDEER_MODEL`,
`BITDEER_BASE_URL`, and `BITDEER_TIMEOUT_MS` from the root `.env` or shell.
Timeout accepts integer milliseconds from 1 to 240000. Model and timeout values
are validated before a request. Each run records the model, endpoint, timeout,
and decision-call count in `metadata.json`; the API key is never recorded.

On October 24, 2026, run `run_6e8c13f2-2206-4977-a1e7-9bd869e6ac49`
sent a real 1280×800 screenshot and observed controls from C's `ver_baseline`
website to `Qwen/Qwen3.8-27B` at `https://api-inference.bitdeer.ai/v1`, with a
60000 ms timeout. Bitdeer returned a valid `type` action for `signup.name`, and
Playwright entered the fictional name `Jaclyn Example`. This was a one-action
smoke test: its expected outcome is `step_limit`, not completed onboarding.
The actual model input included the screenshot and visible controls, not the
hidden checker or route instructions. Generated artifacts remain local/ignored.

To test C's website (two terminals, from the repository root):

```sh
# Terminal 1
npm run dev -w @ghostloop/prototype -- --host 127.0.0.1

# Terminal 2: actual browser decisions, not a saved screenshot
SIMULATOR_BROWSER_CHANNEL=chrome npm run demo -w @ghostloop/simulator -- \
  --prototype-url http://127.0.0.1:5173 \
  --version ver_baseline \
  --goal-adapter "$PWD/packages/prototype-adapter/src/index.ts" \
  --max-actions 16 --headed
```

Use `--max-actions 1` for a single-action validation (up to three requests if retries are needed). The demo command returns
exit status 1 for any incomplete task, including this intentional step limit.
The trusted adapter reads state from the same `--prototype-url` via HTTP.

Full live website verification on October 24, 2026:
`run_d08aa880-80f3-409f-a7ec-6dec3930037c` completed `ver_baseline` in 10
Bitdeer decisions/actions. It filled signup fields, accepted consent, submitted
signup, named one workspace, chose the Free CTA, entered an invite address, and
sent the invite. C's trusted HTTP-backed checker returned all five checks passed.
The result is `outcome: goal`, `goalVerified: true`. The same model, endpoint,
60000 ms timeout, and 1280×800 CSS viewport listed above were used. This validates
the baseline website integration; it does not establish persona coverage or A/B
improvement. The run's artifacts are under `workers/simulator/artifacts/`.


## Browser observation adapter — implemented for C's prototype

`src/browser.ts` now owns:

- `openBrowserSession`: a fresh browser context with no inherited cookies/storage,
  the exact requested version/run URL, request restrictions, and cleanup on
  failed navigation or cancellation.
- `waitForObservationReady`: waits for rendered version-registry content (including
  read-only terminal screens) and fonts, rather than requiring an input to exist.
- `observeControls`: whitelisted visible/enabled controls on the current screen,
  using C's dotted `data-testid` IDs. Records native tag/input type, role, current
  DOM/accessibility label, bounds, allowed actions, select option values, text
  values, and checkbox state. Password values are omitted from this inventory.
- `captureObservation`: a 1280×800 CSS-scaled screenshot plus matching inventory,
  URL, screen ID, viewport, scroll offset and validation alerts. It checks the
  inventory before and after capture, retries up to three times if it changes,
  then reports a browser error instead of storing a mismatched observation.

Every screenshot has a neighboring `.png.observation.json` file. `run.ts` supplies
that same observation's controls and screenshot to Bitdeer; the executor checks
current controls again before acting. These files contain public UI information,
not protected registry flags or hidden checker state. Prior run artifacts are
unchanged; observation sidecars are created on new runs.

The adapter supports C's native input/textarea/select/button/link controls,
including consent checkboxes. It excludes disabled fieldsets, inherited ARIA
restrictions, inert/hidden/transparent elements, covered targets, readonly inputs,
noninteractive decorations, and controls outside the viewport. It resolves
`aria-labelledby`, `aria-label` and associated HTML labels. Duplicate stable IDs
fail explicitly instead of choosing an arbitrary element.

Scope: the current 1280×800, top-document prototype. Scroll actions, iframe/shadow
DOM adapters, custom scripted ARIA widgets, and multiselect controls are not part
of this MVP. Viewport-relative coordinates must not be mixed with full-page images.
Continuous visual changes unrelated to the control inventory are not an atomic
DOM freeze; supported prototype screens should settle before capture.

Observation validation includes a real-browser test against
C's actual Vite website across signup/workspace/plan/invite/confirm and invalid
email correction. Those tests use explicitly scripted decisions (no API credits),
not claims of model-driven recovery. Additional tests cover fresh contexts,
cancellation, Retina dimensions, obscured controls, duplicate IDs and changing
inventories. To rerun:

```sh
SIMULATOR_BROWSER_CHANNEL=chrome npm test -w @ghostloop/simulator
```

Implementation references: [Playwright actionability](https://playwright.dev/docs/actionability)
and [screenshot options](https://playwright.dev/docs/api/class-page#page-screenshot).


The test suite also runs the actual `tsx src/cli.ts --mock` command in a child
process. Browser callbacks must be self-contained: a named local helper inside
`page.evaluate` / `waitForFunction` can cause tsx to emit a `__name` reference that
is not available in the browser. This CLI regression complements Vitest's own
browser tests, which use a different TypeScript transform.

## Action validation — implemented

`src/actions.ts` accepts only strict `click`, `type`, `select`, and `stop` JSON
objects. Unknown/ambiguous IDs, extra fields (including code), unsupported actions,
disabled targets, unknown/disabled select options, overlong values and unfillable
numeric values are rejected. Text is entered with Playwright `fill`, never executed
as JavaScript. Invalid email strings and empty fields remain allowed so agents can
test the website's own validation and recovery behavior.

The worker validates against the captured controls, then checks the live DOM again
immediately before execution. Links and native submit destinations must remain in
the configured prototype; new windows, downloads and non-HTTP links are rejected.
Prototype navigation is restricted to the exact origin/version/screen and one
matching run ID. Context request interception also blocks out-of-scope navigation,
including redirects; observation checks catch out-of-scope client-side route changes.
This is a guard for the controlled prototype, not a sandbox for hostile page scripts.

`src/decision.ts` retries malformed JSON, invalid actions, transport failures,
timeouts, HTTP 408/429 and selected transient 5xx responses. There are at most three
attempts per decision, under the existing overall CLI deadline. HTTP 429 (rate limited)
is handled separately: the decision waits, honoring `Retry-After` or backing off 2, 4, 8
and 16 s (at most 30 s per wait), up to four times without using an attempt. Permanent failures
such as HTTP 401/402/403 are not retried. The next request receives validation
feedback, and cancellation interrupts backoff. Browser actions themselves are never
retried automatically, avoiding duplicate submissions. Exhausted model retries end
as `model_error`, not product-flow blockage.

Check `decision-attempts.jsonl` for retry history and `metadata.json` for the total
request count. `events.jsonl` contains only executed actions. Tests use mocked HTTP
and real local browser pages to verify rejection before side effects, retry bounds,
cancellation, billing errors, stale targets, navigation restrictions, and recovery.
No new live Bitdeer calls are required by this test suite.

## One-run loop — implemented

`runOne(options)` in `src/run.ts` performs one isolated session:

1. Initialize run state, open the exact version URL, observe the page and check the goal.
2. Send the task, public scenario inputs, screenshot, observed controls, current
   screen/alerts, previous actions with their results/alerts, and remaining action
   budget to the decider.
3. Validate the answer (with bounded model retries), revalidate the live target,
   execute once, capture the resulting page and record the action.
4. Invoke the trusted state checker after each action. Repeat until verified success,
   stop, budget exhaustion, no supported controls, cancellation or infrastructure failure.
5. Check state at termination before cleanup, including error exits when state is
   accessible. A checker failure cannot produce verified success. Infrastructure
   failures and cancellation retain their outcomes even if state changed.

The hidden checker, its evidence, protected registry flags and correct route/solution
are never added to model inputs. Public user instructions (such as choosing Free)
remain visible. `runPractice` remains an alias for existing callers. Custom tasks
must be paired with an appropriate trusted checker; changing the task text alone
does not change what the prototype's onboarding checker verifies.

The existing website demo command works unchanged. Optional CLI arguments:

```sh
# Add these to the website demo command only when appropriate for its checker:
--task "Create an account and one Free workspace, then invite a teammate without starting a paid trial."
--scenario-file ./scenario.json
```

A scenario file contains public user context, not solution instructions:

```json
{
  "id": "scn_careful",
  "name": "Careful visitor",
  "description": "You read labels carefully before proceeding.",
  "inputs": {
    "fullName": "Test User",
    "email": "test@example.com",
    "password": "Demo-only-Pass123!",
    "workspaceName": "Research",
    "inviteEmail": "teammate@example.com"
  },
  "runs": 1
}
```

This command still runs exactly one session; `runs` belongs to the shared scenario
format and does not start a batch. The programmatic API also accepts experiment,
protocol and batch IDs for the resulting trace. Use the batch command below for the four controlled scenarios and frozen allocations.

Additional per-run artifacts:

- `model-inputs.jsonl`: the public input for each decision step, including UI feedback
  and remaining budget. Local test credentials and typed text can appear here and
  in action traces; use fictional inputs.
- `execution.jsonl`: started/executed markers, preserving evidence if a subsequent
  observation fails. A started marker alone does not prove an action completed.
- `goal-checks.jsonl`: private checker history, kept separate from model inputs.
- `goal-check.json`: latest prototype checker evidence, when available.

Tests cover custom task/scenario propagation, action budgets, UI validation history,
checker isolation, initially satisfied goals, final checks after faults, and terminal
checker failure, alongside the full real-website onboarding regression. Model
responses are mocked for these tests; no new live-model performance claim is made.

## Independent goal checking — implemented

For prototype runs the worker invokes C's trusted `checkGoal(runId, { baseUrl })`
through the configured adapter. The checker reads persisted server state, not a
success heading or model response. The worker validates the returned run ID,
verdict consistency, unique check names and presence of all five required checks:
account creation, exactly one workspace, Free selected, a valid sent invitation,
and no paid trial. Missing or malformed evidence is an infrastructure error.

C's documented invitation requirement is **at least one valid sent invite**;
workspace count must be **exactly one**. Choosing Pro and later switching to Free
still fails the paid-trial check. Invalid invites are not persisted. Workspace
resubmission updates the existing workspace, and duplicate workspace state fails.

Verification runs initially, after each recorded action, and at termination before
state cleanup. HTTP state reads and custom-adapter waits are bounded to 10 seconds.
Checker faults cannot report success or product-flow blockage. Failed checks are
private evidence, not corrective hints sent to the agent. An error in the latest
check clears stale in-memory evidence and `goal-check.json`; `goal-checks.jsonl`
retains earlier results plus the error for diagnosis. A custom checker that ignores
timeouts cannot be forcibly terminated, but the worker stops waiting for it.

The website regression tests both Free success and Pro failure on the actual
confirmation screen, including a false model success claim. C's checker suite
also covers duplicate workspaces, invalid/missing signup and invites, sticky paid
trials, run isolation and missing state. These tests use no live model calls.

## Complete ordered traces

Each new action event includes experiment/protocol/batch/scenario/version/run IDs,
zero-based per-run sequence, action and target ID, before/after screens, viewport,
validation feedback, execution status, and before/after screenshot references.
Click coordinates come from the browser's trusted pointer event in CSS pixels.
Model retries remain separate decision attempts; they are not browser actions.

An attempted execution that fails still produces an event. `rejected_invalid`
means live target validation prevented execution; `execution_error` means execution
could not be confirmed; `observation_error` means execution completed but the after
observation/artifact failed. Unknown after screens are explicitly `unknown`, and
missing after screenshots are omitted. Step count counts confirmed executed non-stop
actions. The terminal `run.json` records the independently verified outcome.

`runOne` exposes D-compatible `onEvent(event)` plus `onResult(result)` callbacks.
Events are appended locally before delivery; callbacks are awaited in order and
receive copies. Sink failure stops further actions and is recorded in metadata;
the local trace remains available. Delivery is not automatically retried, so a
consumer should deduplicate replayed events by `(runId, seq)`. Result delivery
failure is recorded without rewriting an already finalized run verdict.

For remote replay, supply `publishScreenshot(localRef)` to store/upload the existing
PNG and return a durable `ScreenshotRef`. Publication is awaited before the event
is sent. The model still reads the local PNG; events and result screenshots use the
published reference. Without a publisher, references remain absolute local paths.
No cloud storage or remote event endpoint is provisioned automatically. The batch
adapter must pass D's `onEvent` callback into this single-run API.

Shared event additions are optional for compatibility with older fixtures; the
worker fills them on every new trace. Older traces are not rewritten. The
`events.jsonl` file exists even for runs with zero actions.

## Reliable termination and cleanup

The single-run API supports `goal`, `agent_stop`, `step_limit`, `flow_blocked`,
`model_error`, `browser_error`, and `user_cancelled`. Only an observed page with no
supported controls is classified as blocked; model/browser faults keep their own
outcomes. Terminal `run.json` is written through a temporary file and atomic rename,
then delivered once to `onResult`. The browser closes and run-state deletion is
attempted before terminal delivery, including partial initialization and error exits.
Cleanup errors are retained in metadata rather than silently discarded.

`runOne` enforces `maxWallClockMs` (default 240000) even outside the CLI.
Cancellation interrupts a model or callback that never resolves. Extension hooks,
state initialization, terminal checks, cleanup, and delivery have bounded waits
(`hookTimeoutMs`, default 10000). Browser close also attempts browser shutdown if
context close fails. Cancellation/deadline/global-limit exits use `user_cancelled`
with `stopReason` in metadata. Cleanup/final reporting may take additional bounded
time after the action deadline. Custom hooks should honor cancellation themselves:
a timed-out JavaScript promise cannot be forcibly killed or undo external effects.
A hard process kill or unwritable artifact filesystem cannot guarantee a final file.

D can supply `onUsage(usage)`; it receives cumulative inference attempts and elapsed
milliseconds before/after model attempts and at termination. Returning `false`
stops further model calls/actions. `metadata.json` retains the final usage snapshot.
Live `inferenceUsd` is null unless `estimatedUsdPerCall` is configured; configured
cost is explicitly an estimate, not provider billing. Mock runs report zero cost.
The batch adapter below aggregates call usage and enforces its configured limits.

## Bounded batch runner — four controlled scenarios

With the prototype server running, from the repository root:

```sh
SIMULATOR_BROWSER_CHANNEL=chrome npm run batch -w @ghostloop/simulator -- \
  --prototype-url http://127.0.0.1:5173 \
  --version ver_baseline \
  --runs-per-scenario 1 --concurrency 2 --max-actions 16 \
  --max-calls 120 --max-ms 900000 --headed
```

This uses live Bitdeer credits. It runs four sessions, at most two at once. Sessions are
queued round-robin across scenarios, so a batch that stops early still covers each one:

- First-time/cost-conscious: cautious public persona instructions.
- Returning/product-familiar: confident persona instructions, still with fresh app state.
- Invalid-email recovery: two labeled controlled actions type and submit an invalid
  invitation email. The model then observes the error and chooses how to recover.
- Low persistence: a labeled controlled stop when the user is stuck: two submissions with
  validation errors, three actions in a row that get nowhere (failed, no effect, or back to
  an earlier screen), or 14 actions in total. A clear path still succeeds. This is a fixed
  experimental rule, not spontaneous AI behavior.

Each session owns an isolated browser and a unique initialized server run. Events
carry `decisionSource: "model"` or `"scenario"`; controlled interventions do not
consume model calls. Every new session gets a fresh intervention policy instance.

`--runs-per-scenario 2` schedules eight sessions. Limits are 100 sessions, eight
concurrent sessions, and 20 actions per session. Ctrl+C stops new admissions,
cancels active runs and waits for cleanup. Call budgets reserve requests synchronously
before sending, so concurrent sessions cannot overshoot the cap. The deadline stops
active and queued work; bounded cleanup may continue after it. A single infrastructure
fault (`model_error`/`browser_error`) is recorded and the batch continues; three in a row
stop the remaining batch (`repeated_infrastructure_errors`), and HTTP 402 (out of credits)
stops it at once (`model_credits_exhausted`). Behavioral non-success always continues.

Results are saved under `workers/simulator/artifacts/batches/<batchId>/`:
`batch.json`, `request.json`, `metadata.json`, per-slot usage logs, and each run's
full artifacts. Results are ordered by allocation slot even when sessions finish
out of order. Cancelled batches include only started runs with recorded results;
`plannedRuns` retains the original allocation. Startup failures are listed in metadata.

A `<protocolId>.plan.json` freezes task, scenarios, counts, action limit and concurrency.
For a patched version, rerun with the same protocol and options, changing only
`--version`. Changing the plan requires a new `--protocol`, e.g. `proto_controlled_v2`.
Keep the same artifacts root for both versions; this local plan file is the freeze
record. This does not make stochastic model decisions identical across versions.

D can import `createSimulationAdapter` from `@ghostloop/simulator` and call its
shared `SimulationAdapter.runBatch(request, onEvent, signal)` interface. Pass C's
trusted `goalAdapter`, output directory, provenance and optional screenshot publisher.
All per-run events go to `onEvent`, preserving sequence within each run (concurrent
runs may interleave). Dollar limits require `estimatedUsdPerCall`; they bound the
configured estimate, not actual provider billing. Without pricing, shared usage
contains `inferenceUsd: 0, costKnown: false` as an explicitly unknown total; consumers
must not interpret it as free inference. Mock batches report known zero cost.

Automated tests use scripted decisions and real C website pages with no model
charges. They verify all four scenarios, recovery feedback, isolation/cleanup,
ordered delivery, frozen-plan rejection, concurrency, cancellation and call caps.
