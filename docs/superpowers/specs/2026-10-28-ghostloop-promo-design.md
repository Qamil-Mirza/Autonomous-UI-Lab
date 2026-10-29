# GhostLoop promo storyboard

Deliver a 40-second, 1920×1080, 30fps MP4 plus an editable GSAP browser animation. Use FFmpeg to assemble deterministic browser frames and an original synthesized instrumental bed. No voiceover; large editorial captions carry the story.

## Visual direction

Warm cream, deep green typography, coral accents, rounded product windows, fine grid details, and expressive vector ghosts inspired by the existing mascot. Alternate spacious typography with close-ups of a fictional onboarding app. Maintain one continuous visual journey rather than six disconnected slides.

## Sequence

| Time | Story | Motion and copy |
| --- | --- | --- |
| 0–3 | Hook | GhostLoop. Meet your first users. A curious ghost enters. |
| 3–8 | Drop code | A `signup.tsx` card glides into a GhostLoop drop area. “Drop in your code.” |
| 8–13 | Build frontend | Code becomes a browser with Account → Workspace → Plan navigation. A cursor advances between screens. “An app they can actually use.” |
| 13–19 | Summon agents | A swarm arrives; three featured ghosts are Curious, Impatient, and Cautious, with distinct accessories, expressions, colored trails, and speech bubbles. “Different minds. One mission.” |
| 19–24 | Report friction | Agents hesitate around hidden Free plan, vague Continue label, and competing actions. Coral markers connect to a compact friction report. “See where they get stuck.” |
| 24–29 | Recommend | Three specific recommendations replace issue cards: expose the Free plan, clarify the next step, and make one action primary. “Know what to change.” |
| 29–36 | Apply and retest | An explicit Approve & apply click transforms the UI. Ghosts retry, the route clears, and illustrative friction falls from 3 points to 1. “Small changes. Smoother journeys.” Small legible “Illustrative demo” label accompanies results. |
| 36–40 | End card | Ghosts settle around the wordmark. “Your first users, before your first real user.” Hold for reading. |

## Implementation and verification

Keep all promo source and output in a standalone `promo/` directory, separate from the application. Use a paused GSAP master timeline exposed to a Playwright renderer. Seek to exact frame times; pipe screenshots to FFmpeg. The browser preview supports play/pause/replay and seeking. Assets must be local during rendering. Original synthesized audio avoids third-party music dependencies.

Validate all seven story beats with sampled frames and a contact sheet, inspect browser console errors, check output dimensions, frame rate, duration, audio/video streams, and decode the entire MP4 with FFmpeg. Deliver the MP4, preview, source, render instructions, and contact sheet.

The promo is an illustrative product narrative, not an actual model trial or a claim of measured customer performance.
