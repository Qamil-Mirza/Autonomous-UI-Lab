# GhostLoop × Figma Make — 3-minute demo video

**Story:** import a Figma Make app, describe what users should be able to do, watch simulated users try it, approve
a suggested change, and see GhostLoop *measure* it. That includes catching a suggestion that made things worse.

**Honesty rules (from the PRD):**
- Footage recorded before the shoot is labeled on screen.
- The Northwind app is a compatibility fixture that mimics a Make export, not one.
- Results come from real model runs (Bitdeer for simulated users, Claude for analysis), not mocks.

## Before recording (about 10 minutes)

1. Start everything: `./demo.sh`. Wait for "GhostLoop is running".
2. Use Chrome at **1440×900**, 100% zoom, with bookmarks and extensions hidden. The dashboard is at http://localhost:5174.
3. Run `npm run fixture:zip -w @ghostloop/importer`. It writes the ZIP to
   `packages/importer/fixtures/northwind-make-export.zip`. Copy it to the Desktop as `Northwind Coffee.zip` so the
   file picker looks clean.
4. Check the finished experiment to show. Under **Tests** the test is named after its task, "Order one flat white for
   pickup and get the order confirmed.", with the ID `exp_2737ad0f4a9f`. It shows:
   - a baseline of 1 of 6;
   - Claude's suggestion "Continue" → "Continue to pickup details" (`src/components/Bag.tsx:34`);
   - a retest of 0 of 6, **Rejected**, with every quality check passed.

   Recorded evidence, checked against the run files:
   - **Baseline:** every one of the 6 trials pressed **Continue** on the bag and landed back on the menu, 1–3 times
     each. Trial 02 bounced 3 times. Trial 04 is the one success: it bounced twice before finding "Save bag".
   - **Retest:** all 6 trials clicked the renamed "Continue to pickup details" and bounced.
5. Open the old import "Northwind fixture 06:50", so it is in the import list and the preview is warm.
6. Optional: a dry run of the "Suggest checks" button. It's one Claude call, about $0.02 and about 10 seconds.

## Shot list and narration (3:00)

| Time | On screen | Say |
| --- | --- | --- |
| **0:00–0:15** | Landing page (reload http://localhost:5174) → **Open dashboard** → Overview → **Import Figma Make app**. Don't reload mid-take: every reload returns to the landing page. | "You built a prototype in Figma Make. It runs. But will people actually finish the task? With no traffic yet, you can't A/B test it. GhostLoop can." |
| **0:15–0:45** | **Import app** → name "Northwind Coffee" → drop the ZIP → **Upload and build**. The stepper runs Validating → Building → **Ready for review**, about 15 s (speed up 2–4×). Scroll to the live preview. | "I export the code from Make and drop in the ZIP. GhostLoop checks it, then installs and builds it in an isolated container. Nothing runs on my machine. Here's the live preview, on its own sandboxed origin." |
| **0:45–1:20** | Type the task: *"Order one flat white for pickup and get the order confirmed."* Point at the **Judged** badge. Click **Suggest checks**, then **Add all**; the badge flips to **Verified**. Add test data `name=Pat Example` / `email=pat@example.com`. **Save and check**, then **Freeze and continue**. | "I just describe the task. That's enough: a separate Claude judge can score each attempt. But I can upgrade to verified success. GhostLoop suggests checks from my app's own text and routes: reach `/order/confirmed`, see 'Order confirmed'. Now success is decided by code, not by a model. I freeze it, so every retest uses exactly this definition." |
| **1:20–1:30** | Set trials to 6 → **Start the baseline test**. Show it running for a moment. | "Six simulated users, real browsers, real model decisions." |
| *(cut)* | Lower-third: **"Recorded earlier today: same app, same task"** | |
| **1:30–2:00** | Open the finished experiment from Before recording step 4 → **Runs**. Metrics show **1 of 6**. Open **Trial 02** and step through its screenshots to a **Continue** click that lands back on the menu. Then show **Trial 04**, the only success, then show the **Success checks** ✓/✕ panel. | "Only one in six made it, and even that one went in circles first. Here's why: on the bag page, the big **Continue** button sends you back to the menu. Checkout hides behind 'Save bag'. People go round in circles. And success is checked on the final page, never taken from the agent's word." |
| **2:00–2:20** | **Recommendations** → **Review**: the suggestion card with **before → after** and the source location `src/components/Bag.tsx:34`. Click **Test the selected improvements**. | "Claude reads the evidence and proposes one wording change, tied to an exact line of my Make code. Nothing changes until I approve it." |
| **2:20–2:50** | **Results**: **Rejected**, 16.7% → 0%, Quality check **Passed**, original and updated previews side by side. Optional 3 s cutaway: a retest trial clicking "Continue to pickup details" and landing on the menu. | "GhostLoop builds the change as a separate version, checks it, and retests it under the same frozen task. And it got *worse*. The new label made the wrong button even more convincing. The AI's idea sounded reasonable. The measurement says no. So my original stays, untouched." |
| **2:50–3:00** | Back on the import page: the Northwind preview. | "Import, describe, test, approve, measure. Your Make prototype, with evidence instead of guesses." |

## If something goes wrong on camera

- **Build slow or failed:** cut to the already-imported "Northwind fixture 06:50", which is ready to test.
  Failures show the step, the code, a hint and the build log.
- **Suggest checks slow or failing:** add the checks by hand. Use **Shows text** "Order confirmed" and
  **Reaches a route** `/order/confirmed`.
- **Worker not reachable:** rerun `./demo.sh`. It reuses running services and restarts only what's missing.

## Accuracy notes for captions or Q&A

- Simulated users are Bitdeer-hosted models driving real Chromium. Each trial gets a fresh browser with fresh app state.
- Northwind is a hand-written compatibility fixture shaped like a Make export.
- A real Make export (React 19, Vite 8) has been imported, built and previewed. A full experiment on a real export hasn't been recorded yet.
- Changes are written to a new code version, not back into Figma.
- "Verified" means checked by code on the final page. That is UI evidence, not proof that a backend did anything.
