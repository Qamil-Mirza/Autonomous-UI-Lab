# GhostLoop product film

A 40-second animated promo covering code import, a navigable frontend, personified ghost testers, friction reports, recommendations, and an approved change followed by a smoother retest.

## Deliverables

- `output/ghostloop-promo.mp4`: 1920×1080, 30fps, H.264/AAC, original electronic soundtrack.
- `output/storyboard.jpg`: eight representative scenes.
- `index.html`, `style.css`, `animation.js`: editable animation and playback interface.
- `output/soundtrack.wav`: original synthesized instrumental score, with no third-party samples.

The app UI and findings are illustrative. The 3 → 1 friction count is sample data, not a measured result or performance guarantee. The approval step is shown before changes are applied.

## Preview

From the repository root:

```sh
node promo/render.mjs --preview
```

Open http://127.0.0.1:5188. The preview includes play/pause, replay, a scrubber, sound control, and a download link. Press Play to start; no autoplay audio.

## Render

Requires the repository's existing Playwright dependency, Google Chrome, Python 3, and FFmpeg on PATH. GSAP and fonts are local; rendering does not require network access or API keys.

```sh
python3 promo/audio.py
node promo/render.mjs --stills
node promo/render.mjs
ffmpeg -y -hide_banner -loglevel error -pattern_type glob -i 'promo/output/0*.png' -vf 'scale=640:360,tile=2x4:padding=12:margin=12:color=0x172c26' -frames:v 1 promo/output/storyboard.jpg
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,duration -show_entries format=duration -of json promo/output/ghostloop-promo.mp4
ffmpeg -v error -i promo/output/ghostloop-promo.mp4 -f null -
```

The renderer seeks the master GSAP timeline at each exact 1/30-second timestamp and pipes 1,200 frames into FFmpeg. It then mixes in the score, normalizes audio to -18 LUFS, and writes the final MP4 with fast-start metadata. A silent `picture.mp4` intermediate is retained. The renderer also checks for browser errors; still capture verifies the preview controls.

## Editing

`animation.js` contains scene markup, vector ghost artwork, and a single GSAP timeline. The eight scene boundaries are 0, 3.2, 8.2, 13.2, 19.2, 24.2, 29.2, 36.2, and 40 seconds. Use `window.seekFilm(seconds)` in the browser console to inspect any moment. CSS holds the art direction; `audio.py` holds the deterministic oscillator-based score.

## Assets

- GSAP 3.14.2: downloaded from the official npm distribution through jsDelivr; license header is retained in `assets/gsap.min.js`. See https://gsap.com/standard-license/.
- Inter: copied from the repository's installed `@fontsource/inter`; SIL Open Font License in `assets/INTER-LICENSE.txt`.
- Ghost artwork, UI illustration, animation, and score were created for this promo. The visual palette and character cues follow the existing GhostLoop project.
