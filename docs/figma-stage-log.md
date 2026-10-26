# GhostLoop — Figma Stage Log (DRAFT)

**Status:** Draft. Minutes and ratings marked `[TODO]` must be filled by the person who did the work. Repository evidence is cited by commit hash.

**Scope of this entry:** the GhostLoop app build, covering only the stages Figma Make was used for, including the skills run inside Make. Ownership of each contribution follows [the sponsor brief](FIGMA-SPONSOR-BRIEF.md).

---

## 1. Ideation

**Tools and why:** Figma Make, used to explore the GhostLoop dashboard and landing hero as a clickable concept before any code existed. Make was chosen so the idea could be seen and changed quickly. Make set the visual tone on its own: we uploaded the GhostLoop icons and the product name as the title, and Make derived the look (palette, type, mood) from them. We did not write a style brief.

**Approximate minutes:** [TODO]

**Rating (Figma tool experience, 1–5):** [TODO]

**Input → output → final project:** Uploaded icons + product name title → Make-generated tone and layout → Make prototype of the designer dashboard. The Make export was committed as `aff7ec7` ("port the Figma Make dashboard into the workspace") and became `apps/dashboard`, still on sample data. The Make platform files were dropped in that commit.

**Friction and iteration:** [TODO: list any abandoned concepts, prompt rework, or loops back to ideation after testing.]

---

## 2. Prototyping

**Tools and why:** Figma design file "Calhacks-13.0", page **01 Baseline A**, holding the onboarding frames (signup → workspace → plan → invite → confirm). Figma was used to lay out the screens at 1280×800 so the coded version had a reference to match.

**Approximate minutes:** [TODO]

**Rating (Figma tool experience, 1–5):** [TODO]

**Input → output → final project:** Frames on "01 Baseline A" → the Matrix Coor onboarding app `apps/prototype` (`99465d9`), where every dotted Figma layer name is rendered as a `data-testid`. Back-link positions and the sparkle scaling were matched to the new frames in `1f8f1ff`.

**Friction and iteration:** Frames were revised after the first build (`1f8f1ff`), so the back links and the sparkle were reworked to match. [TODO: confirm whether the frame edits came from Make or from the Figma design file.]

---

## 3. Handoff

**Tools and why:** Figma design file as the source of truth for labels and element IDs. A manifest was used to carry those values into code without a rebuild. The Figma MCP `use_figma` read-back was used to check the frames against the candidate.

**Approximate minutes:** [TODO]

**Rating (Figma tool experience, 1–5):** [TODO]

**Input → output → final project:** Labels and layer names from "01 Baseline A" → `designs/versions/ver_baseline.json` (38 elements, labels taken from Figma) → served to `apps/prototype` at runtime. The verified mapping is `designs/figma/ver_baseline.json` (`9613cf1`, 111/111 checks). The reusable recipe is `docs/figma-variant-workflow.md`.

**Friction and iteration:** Figma cannot represent `styleToken` or `order`, so those changes are recorded as unsupported (status `mismatch`) and never faked. [TODO: note any manual steps.]

---

## 4. Code generation

**Tools and why:** Figma Make, used to generate the code for the dashboard and the hero animation. The `find-animation-opportunities` and `better-interface` skills were run inside Make to decide the motion and the interface polish. [TODO: confirm which session produced `99465d9`.]

**Approximate minutes:** [TODO]

**Rating (Figma tool experience, 1–5):** [TODO] (Rate Make's code generation.)

**Input → output → final project:** Make export → `apps/dashboard` (`aff7ec7`). The hero float is CSS in `apps/dashboard/src/index.css` (~line 229), based on the plan at `apps/dashboard/plans/ghost-hero-animation.md`, which lives in git history at `aff7ec7`. The prototype app `apps/prototype` came from the Figma page via Claude Code, not from a Make export (`99465d9`).

**Friction and iteration:** The dashboard still uses sample data (`sampleData.ts`), so it is not yet wired to live data. The Make export needed a type-syntax fix and Vite/React alignment before it ran (`aff7ec7`).

---

## Notes for the reviewer

- Commit `99465d9` is authored by a teammate. Its entry above should be checked against that teammate's own account.
