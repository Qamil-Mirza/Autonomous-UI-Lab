# GhostLoop — launch film

A 71-second, 1920×1080 / 30 fps product launch film. The real GhostLoop dashboard and the Matrix Coor test app are on screen for every product beat; GSAP animates the stage and FFmpeg encodes it. No voiceover: large editorial captions carry the story over an original synthesized score.

**The message:** GhostLoop sends AI users through your real app before launch, shows you where they get stuck, proposes one small change, and measures whether it helped, with you approving every change.

## Sequence

| Time | Beat | Caption |
| --- | --- | --- |
| 0–3 | Hook | You're about to launch. |
| 3–7 | Problem, mascot peeks in | Nobody has used it yet. |
| 7–11 | Wordmark reveal | ghostloop · Your first users, before your first real user. |
| 11–18 | Dashboard setup, task types itself, Start is pressed | Describe what a user should be able to do. |
| 18–29 | Matrix Coor: three testers arrive, signup → workspace → plan, two drift to the paid trial | AI users try your real app. In a real browser. / Watch where they get stuck. |
| 29–36 | Runs view, action timeline, "50% · 2 of 4 trials reached the goal" | Every step recorded. / Success is checked from app state, not the agent's word. |
| 36–44 | Recommendations: pattern and one labeled suggestion | Finds the pattern. Proposes one small change. |
| 44–50 | Review: before → after, "Test the selected improvements" | Nothing changes until you approve it. |
| 50–58 | Results: 50% → 66.7%, +16.7 pp, Accepted | Retested under the same task. / Measured, not guessed. |
| 58–63 | Baseline and candidate frames on a design canvas, "Design match · Verified" | Every tested version lands in Figma. Editable. |
| 63–71 | Six-word loop, then the mark | Your first users, before your first real user. |

## Watch

- Final video: `output/ghostloop-launch.mp4`
- Storyboard contact sheet: `output/storyboard.jpg`
- Score: `output/score.wav`

## Preview

```sh
node promo/launch/render.mjs --preview
```

Open http://127.0.0.1:5189. Play/pause, replay, scrubbing, and sound are below the stage. `seekFilm(seconds)` in the console seeks the film; `REVIEW_FRAMES` lists the storyboard timestamps.

## Render and verify

Requires the repository's Playwright dependency, Google Chrome, Python 3 with numpy, and FFmpeg on PATH. Rendering needs no servers, keys, or network: every screenshot and font is local.

```sh
python3 promo/launch/audio.py          # original score → output/score.wav
node promo/launch/render.mjs --stills  # storyboard frames + story checks
node promo/launch/render.mjs           # 2130 frames → output/ghostloop-launch.mp4
ffmpeg -y -v error -pattern_type glob -i 'promo/launch/output/stills/*.png' -vf 'scale=640:360,tile=3x5:padding=6:margin=6:color=0x222222' -frames:v 1 promo/launch/output/storyboard.jpg
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,nb_frames -show_entries format=duration -of json promo/launch/output/ghostloop-launch.mp4
ffmpeg -v error -i promo/launch/output/ghostloop-launch.mp4 -f null -
```

The stills pass checks that only one caption is visible at a time, that the cursor lands inside the real Start, Review, and Test buttons, that the task text types in, that the result counts up to 66.7%, that the end card shows, that backward seeks are deterministic, and that the preview controls work. It fails on any browser error.

## Re-capturing the product

`capture.mjs` screenshots the live dashboard (http://localhost:5174, started by `./demo.sh`) and the prototype (http://localhost:5173) at 1440×900 @2x into `assets/ui/`, and records element bounding boxes into `assets/ui/boxes.json`. Every annotation, ring, and cursor target in the film reads those boxes, so re-capturing after a UI change keeps the highlights on the right controls. After re-capturing, regenerate `assets/ui/boxes.js`:

```sh
node promo/launch/capture.mjs
(printf 'window.UI_BOXES='; cat promo/launch/assets/ui/boxes.json; printf ';\n') > promo/launch/assets/ui/boxes.js
```

The results screen (`results.png`) comes from the dashboard running without a database connection, which shows its built-in sample comparison; the live stack has no read-only route to a finished comparison. The film labels that beat "Illustrative sample result". Nothing in the film is a measured performance claim.

## Edit

- `index.html`: stage, titles, product windows, Figma canvas, loop, end card, preview controls.
- `style.css`: brand tokens from the dashboard (cream, ink, coral), captions, windows, annotations.
- `ghosts.js`: original line-art testers drawn to match the mascot, plus the pointer.
- `animation.js`: the GSAP master timeline. `focus()` is the camera: it moves a window so a screen point lands on a stage target at a given scale. `captions` holds the copy and timings.
- `audio.py`: deterministic score (numpy): 104 BPM pulse, D-major plucked motif, swells at the reveal and result, ticks on captions, clicks on cursor presses.
- `render.mjs`: local server, exact-frame capture, story checks, encode, mux.

## Credits

GSAP 3.14.2 vendored from npm with its license header (https://gsap.com/standard-license/). Inter under the SIL Open Font License (`assets/INTER-LICENSE.txt`). The mascot is the dashboard's own artwork. Tester ghosts, motion, and score are original to this project. Reference study for structure and pacing: Linear, Raycast, Arc, Loom, and Figma Config launch films; no footage, artwork, or music from them is used.
