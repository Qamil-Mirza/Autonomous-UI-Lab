# Part B: single-user practice simulator

Runs a real browser against a tiny local workspace form. In live mode Bitdeer sees
screenshots, the task, observed controls, prior actions, and the remaining budget.
It chooses an action; the worker validates and executes it. Success requires
exactly one workspace named `Demo` in the fixture's actual session state.

This is the first single-run milestone, not the complete Part B batch service or
Group C's signup/Free-plan/invite flow. The Python screenshot smoke test remains
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
at six actions by default (configurable 1–20), 60 seconds per model request, and
four minutes overall. This milestone fails closed on invalid model output; it does
not retry inference automatically.

## Artifacts

Each run writes an ignored directory under `workers/simulator/artifacts/run_.../`:

- `run.json`: validated shared `AgentRunResult`, including outcome and verified goal.
- `events.jsonl`: ordered completed actions, appended as the run progresses.
- `000.png`, `001.png`, etc.: initial screenshot and screenshots after each action.
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

- C: agree on stable `data-agent-id` values, labels, screen IDs, and reset/run-isolated state.
- C: replace the practice state checker with the trusted full onboarding checker.
- C: replace the fixture-only URL restriction with the agreed prototype route allowlist.
- D: retain the existing shared contract types; add the actual experiment/version/scenario IDs.
- D: implement `SimulationAdapter.runBatch` with budgets, event streaming, and concurrency next.
- A/D: connect artifact storage and replay to the returned screenshot references.

Current observation supports visible, enabled inputs, textareas, buttons, and
selects fully inside the viewport. Scrolling, arbitrary sites, batch execution,
full onboarding scenarios, cost accounting, and retry policies are not implemented.
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
