# Bitdeer screenshot smoke test

This Python smoke test sends one screenshot to Bitdeer and prints its description.
Supplying `--controls` instead requests one validated action.
It does not operate a browser or produce a complete GhostLoop run trace.
The production simulator belongs in `workers/simulator`; shared contracts remain
unchanged.

Existing dependencies: `openai` and `python-dotenv`.

Set these in the repository-root `.env` (not `packages/.env`):

```dotenv
BITDEER_API_KEY=your-key
BITDEER_BASE_URL=https://api-inference.bitdeer.ai/v1
BITDEER_MODEL=Qwen/Qwen3.8-27B
```

The default model successfully read `prototype-ex1.png` through this account's
Bitdeer endpoint on October 24, 2026. The documentation's Kimi example returned
404 and was absent from the endpoint's model list. Existing shell environment variables take
precedence over `.env`. Never commit keys.

## Screenshot only (no website needed)

Run from the repository root:

```sh
python3 packages/contracts/scripts/screenshot_actions.py screenshots/prototype-ex1.png \
  --model Qwen/Qwen3.8-27B \
  --task "Describe this wallet screen. Read the balance and transaction amounts. Identify visible navigation controls and explain what is uncertain about their purpose."
```

This sends the image to Bitdeer and prints a visual interpretation, not an
executable action or verified task outcome. It still requires API credits.

Live test result: Qwen read the balance as $18,678 and the transactions as
Shopping −$16.35, Jane Cooper +$24.00, and Taxi −$8.20. These match the image.
It identified the menu, avatar, and bottom arrow, while noting that their actual
behavior cannot be confirmed from a screenshot. A 512-token output budget produced
no answer text; the successful request used 2,048 tokens. No browser actions ran.

## Validated action (requires a control inventory)

Save a PNG/JPEG screenshot of your prototype under 1 MB. Create a JSON file
describing the visible, enabled controls in that same screenshot. For example
(replace these entries with your actual controls):

```json
[
  {"elementId": "workspace-name", "label": "Workspace name", "allowedActions": ["type"]},
  {"elementId": "free-plan-button", "label": "Choose Free", "allowedActions": ["click"]}
]
```

For select controls include `"options": ["free", "pro"]` containing actual option
values. IDs must match the prototype's stable element IDs. This standalone test
trusts your inventory; the browser adapter will eventually extract it directly.

Run from the repository root, substituting your actual file paths:

```sh
python3 packages/contracts/scripts/screenshot_actions.py screenshots/prototype-ex1.png \
  --controls /tmp/controls.json \
  --task "Find the wallet navigation menu"
```

The screenshot and controls are sent to Bitdeer. Use the fictional demo app.
Output is a JSON action (`click`, `type`, `select`, or `stop`). No action is executed.
Malformed or unsupported model actions fail validation. HTTP 402 means the
account needs its Model Studio credits allocated; changing the URL will not fix it.

Reference: https://developers.bitdeer.ai/docs/guides/llm/vision
