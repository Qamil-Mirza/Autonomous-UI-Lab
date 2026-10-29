# GhostLoop — motion-first promo (v4)

A 32-second, 1920×1080 / 30fps film, animated with GSAP and rendered with FFmpeg. This revision uses a familiar upload animation and a spookier original score:

1. A file-selection click reveals app.tsx, an upload progress bar fills, and a completion check appears before the card expands into a navigable app.
2. Three featured ghost personalities pop up, followed by nine more testers.
3. The swarm circles the screen and spirals into it, contracting in position and scale.
4. Ghosts explore the UI and get angry at friction points: furrowed brows, frowns, frustration marks, and a short shake.
5. Two compact recommendations move into the interface after approval.
6. The ghosts return to happy faces on the retest; all three friction markers disappear, followed by a brief brand ending.

One short caption appears at a time. The film uses eased UI transitions, curved ghost paths, depth, and a minor-key music-box soundtrack with ghostly swells and soft low pulses. The UI and 3 → 0 friction count are illustrative, not measured performance claims.

## Watch

- Final video: `output/ghostloop-promo-v4.mp4`
- Contact sheet: `output/storyboard-v4.jpg`
- Original score and movement accents: `output/soundtrack-v3.wav`
- Earlier motion cut retained at `output/ghostloop-promo-v2.mp4`, with source in `archive/v2/`. First cut retained at `output/ghostloop-promo-v1.mp4`; its source is in `archive/v1/`.

## Preview

```sh
node promo/render.mjs --preview
```

Open http://127.0.0.1:5188. Play/pause, replay, scrubbing, sound control, and the MP4 link are below the stage. If the preview was already open from v1, refresh it.

## Render and verify

Requires the repository's existing Playwright dependency, Google Chrome, Python 3, and FFmpeg on PATH. All animation assets are local; no model calls or network access are needed for rendering.

```sh
python3 promo/audio.py
node promo/render.mjs --stills
node promo/render.mjs
ffmpeg -y -v error -pattern_type glob -i 'promo/output/v4-stills/*.png' -vf 'scale=480:270,tile=3x4:padding=8:margin=8:color=0x183c30' -frames:v 1 promo/output/storyboard-v4.jpg
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,duration,nb_frames,sample_rate -show_entries format=duration -of json promo/output/ghostloop-promo-v4.mp4
ffmpeg -v error -i promo/output/ghostloop-promo-v4.mp4 -f null -
```

The renderer seeks the GSAP master timeline at exact 1/30-second timestamps, pipes 960 frames into FFmpeg, and produces H.264 with limited-range BT.709 color and stereo 48kHz AAC. It checks the 32-second timeline, eight narrative beats, and twelve ghosts. Still verification also checks upload cursor targeting, intermediate progress, completion, removal of the box, backward-seek determinism, one-caption visibility, all ghosts entering the screen, browser errors, and preview controls.

## Edit

- `index.html`: one continuous stage, upload/app, UI, findings, and end card.
- `style.css`: cream/coral art direction and dark swarm environment.
- `characters.js`: original ghost designs retained from v1.
- `animation.js`: GSAP timeline, scene captions, procedural spiral, and playback.
- `audio.py`: deterministic original minor-key music box, detuned pads, theremin-like ghost calls, room reflections, and movement accents.
- `render.mjs`: local server, exact-frame capture, encoding, and verification.

In the console, `seekFilm(seconds)` seeks the animation. `FILM_BEATS` and `REVIEW_FRAMES` describe the story and review samples. Swarm transforms derive from timeline-owned state, so playback, scrubbing, and rendering agree.

## Reference study and assets

Visual research included the [Introducing Spline](https://www.ordinaryfolk.co/project/introducing-spline) film's publicly hosted preview frames, [Webflow: A New Era of No-Code](https://www.ordinaryfolk.co/project/webflow-a-new-era-of-no-code), and [BUCK's Nothing Playground](https://buck.co/work/nothing-playground) project notes. These informed object continuity and playful staging; no reference footage, artwork, or music is included. No conversion-performance claims are made about these references.

GSAP 3.14.2 is vendored from its npm distribution, with the license header retained; see https://gsap.com/standard-license/. Inter uses the SIL Open Font License included at `assets/INTER-LICENSE.txt`. Ghost artwork, motion, UI illustration, and soundtrack are original to this project.
