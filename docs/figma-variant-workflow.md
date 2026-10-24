# Figma variant workflow

How a designer gets an editable Figma frame for a candidate design version, with a verified record that the frame matches the React candidate. Claude Code does the work through the Figma MCP server; a designer triggers it. Nothing in the optimizer loop calls Figma.

Each run produces three things:
- a variant frame on the **"02 Candidates"** page, named `<screen> · <versionId>`, one per screen the candidate changes;
- a mapping file `designs/figma/<versionId>.json` (a superset of the contract `FigmaReference`) with status `verified` or `mismatch` and every per-element check;
- `GET /api/figma/<versionId>` on the prototype server, which serves that file (or `{ versionId, status: "pending" }` before it exists).

## Prerequisites

- The Figma MCP server is connected to Claude Code, and you can edit the file: `https://www.figma.com/design/hUYlyMbzUB2LnefdcudZOb/Calhacks-13.0`.
- The prototype is running: `npm run dev -w @ghostloop/prototype`, on http://localhost:5173.
- The candidate exists: `designs/versions/<versionId>.json` and `designs/candidates/<candidateId>.json`, written by the `CandidateAdapter` (or `npm run candidate:demo -w @ghostloop/prototype-adapter`).
- The baseline frames on **"01 Baseline A"** haven't been edited since `designs/figma/ver_baseline.json` was last checked. If they have, re-verify the baseline first (see below).

## The prompt

Paste this into Claude Code from the repo root, with `<candidateId>` filled in:

```text
Create the Figma variant for candidate <candidateId> and verify it.

Follow docs/figma-variant-workflow.md exactly. Load the figma-use skill (and figma-generate-design) before any use_figma call.
Figma file: https://www.figma.com/design/hUYlyMbzUB2LnefdcudZOb/Calhacks-13.0 . Baseline frames are on "01 Baseline A";
variants go on "02 Candidates". Do not change any frame on "01 Baseline A".

1. Read designs/candidates/<candidateId>.json for the versionId, and run diffManifests(ver_baseline, <versionId>)
   from @ghostloop/design-engine to get the per-element changes and the screens they touch.
2. For each changed screen, duplicate its baseline frame (the one named exactly <screen>, not <screen>--error) onto
   "02 Candidates", named "<screen> · <versionId>", in a free spot that doesn't overlap existing variants.
3. Apply only the diff, to the layers named by element ID:
   - label: set the label TEXT's characters (load its font first). If the element is a button, measure the React
     candidate's element width with Playwright at 1280×800 on /v/<versionId>/<screen> and resize the button frame
     to match, keeping the label centred.
   - visible: set node.visible.
   - styleToken / order: do not apply or fake them. They will be recorded as unsupported (status mismatch).
4. Read the variant frames back with packages/design-engine/figma/snapshot.js (replace __FRAMES__) and save the
   result as {"fileKey": "hUYlyMbzUB2LnefdcudZOb", "frames": <result>}. Do the same for the baseline frames of
   "01 Baseline A" (all of them, including the --error frames).
5. Run npm run figma:mapping -w @ghostloop/prototype-adapter -- --version <versionId> --snapshot <variant.json>
   --baseline-snapshot <baseline.json> --frame-url <URL of the variant frame, node-id with "-">.
6. curl http://localhost:5173/api/figma/<versionId> and report the status. If it is mismatch, list every failed
   check (element, field, expected, actual). Do not edit Figma to make a check pass unless I ask.
7. Screenshot the variant (get_screenshot, maxDimension 1280) and the React candidate at 1280×800, and show them
   side by side.
```

## What happens, step by step

1. **Diff.** `diffManifests(parent, child)` (`packages/design-engine/src/diff.ts`) returns, for each element whose presentation changed, the `label` / `visible` / `styleToken` / `order` changes with `from` and `to`. It throws if the element IDs differ, which the `manifest_ids_stable` guardrail already rules out for real candidates.
2. **Duplicate.** Only screens with a changed element get a variant. The duplicate keeps every layer name, so element IDs still identify layers.
3. **Apply.** Label and visibility map directly onto Figma layers. The frames use absolute positioning, so a longer button label means resizing the button frame to the width React measures; nothing else moves. Changes Figma can't express are never faked:

   | Change | In Figma | Recorded as |
   |---|---|---|
   | `label` | TEXT characters (and button width) | checked against the candidate label |
   | `visible` | `node.visible` | checked against the candidate value |
   | `styleToken` | not applied: frames have no style tokens | failed check, `note` says why → `mismatch` |
   | `order` | not applied: absolute layout can't represent manifest order | failed check, `note` says why → `mismatch` |

4. **Read back.** `figma/snapshot.js` is read-only. For every layer named like an element ID it records the type, effective visibility (the layer and every ancestor), the text of every TEXT in its subtree, the nested element IDs, bounds relative to the frame, and a serialized style (fills, strokes, fonts).
5. **Check.** `checkVariant` (`packages/design-engine/src/figma-check.ts`) compares the variant snapshot against the candidate manifest and the baseline snapshot:
   - **changed:** each changed field shows the candidate's value. A label matches if some TEXT in the layer equals it after collapsing whitespace (and dropping the decorative "←" on back links).
   - **protected:** every protected element on the screen is identical to the baseline frame (texts, visibility, bounds, style).
   - **unchanged:** every other element on the screen is identical too, which catches accidental edits. A container whose child changed (e.g. `workspace.form` around a relabelled `workspace.continue`) isn't compared as a whole; the child is checked on its own.
6. **Record.** `figma:mapping` writes `designs/figma/<versionId>.json`. Re-running overwrites it: the mapping records the latest read-back.

## Status meanings

| Status | Meaning |
|---|---|
| `verified` | Every check passed: the frame shows exactly the candidate's changes and nothing else moved. |
| `mismatch` | At least one check failed, or a change is unsupported in Figma. Every failure is listed in `checks` with `expected`, `actual` and, for unsupported changes, a `note`. Treat the frame and the React candidate as out of sync. |
| `pending` | No mapping file exists yet (served by the endpoint, never written to disk). |

## Re-verifying after a designer edits a variant

Designers can edit variant frames freely. Before the frame is treated as matching the candidate again, rerun steps 4 to 6 (snapshot, `figma:mapping`, curl). Any change that is no longer in sync with the React candidate turns the status to `mismatch` and is listed. The mapping never claims a match it didn't read back.

## Re-verifying the baseline

`designs/figma/ver_baseline.json` is committed. Its `frameUrl` points at the "01 Baseline A" page. `checkBaseline` checks every manifest element against the baseline frames: a layer exists on a frame of its screen (error elements live in the `--error` frames), its label appears in that layer, and its visibility matches. Order isn't checked. To refresh it after a baseline edit:

```sh
npm run figma:mapping -w @ghostloop/prototype-adapter -- --version ver_baseline --snapshot <baseline.json> \
  --frame-url "https://www.figma.com/design/hUYlyMbzUB2LnefdcudZOb/Calhacks-13.0?node-id=15-122"
```

Then commit the updated file. Candidate mappings (`designs/figma/ver_*.json` other than the baseline) are gitignored, like candidate versions.
