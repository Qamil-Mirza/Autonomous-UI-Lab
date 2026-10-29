# GhostLoop — promo (v5)

A 30-second, 1920×1080 / 30 fps film, animated with GSAP and rendered with FFmpeg. v5 rebuilds the v3 story in the product's brand and with real motion design.

**What changed from v3:**
- **Brand palette.** Cream `#f7f7f2`, ink `#17201d`, coral `#ee7375`, and the dashboard sidebar ink `#202825` for the night swarm, all from `apps/dashboard/src/index.css`. The lowercase `ghostloop` wordmark has the coral "oo" loop, next to the real mascot. The tested app is neutral, so coral only ever means GhostLoop.
- **Line-art ghosts in the mascot's style.** White body, thick ink line, coral cheeks. Personality comes from props (magnifier, sweatband, glasses) and behavior, not fill colors.
- **Character animation.** Each ghost is a rig redrawn every frame: anticipation, squash on impact, stretch along fast paths, lean into motion, a waving hem, idle bob, eyes that follow travel direction, timed blinks, and mood changes (happy, worried, angry, wow).
- **A camera.** One world under one camera that pushes, pulls, and whip-pans between the paid button, the Free button, and the review panel.
- **Transformations instead of cross-fades.** The drop zone becomes the app window, friction pins morph into suggestion cards, the cards fly back into the button they fix, and the window collapses into the logo's loop.
- **Motion blur.** Frames are captured at 60 fps and pairs are blended with FFmpeg `tmix` into 30 fps.

## Story

| Time | Beat | Caption |
| --- | --- | --- |
| 0–3 | A zip arcs in under gravity, lands with a squash; the drop zone gulps; upload ring fills | Drop in your app. |
| 3–6 | The drop zone expands into the app window; the plan picker assembles | We build it. |
| 6–9 | Ink wipe; three testers shoot up in front of the app with name chips; nine more pop in | Meet your testers. |
| 9–12 | The swarm orbits in front of and behind the window, accelerates, and dives into the screen | AI users. Real browser. |
| 12–17 | Camera whips between buttons: two testers bonk the loud paid-trial button, one hesitates on Free and goes back to compare; coral pins | See where they get stuck. |
| 17–21 | Pins morph into two suggested fixes in the GhostLoop panel; the cursor approves | You approve every fix. |
| 21–24.5 | The fixes fly into the Free button, which becomes primary; testers press it and celebrate; 3 → 0 stuck points | Then we test it again. |
| 24.5–30 | The window collapses into the coral loop; testers fly a figure-eight through the "oo"; mascot and tagline | ghostloop · Your first users, before your first real user. |

The UI, friction points, and 3 → 0 count are illustrative, not measured performance claims. The film no longer carries an on-screen "Illustrative demo" label.

## Watch

- Final video: `output/ghostloop-promo-v5.mp4`
- Contact sheet: `output/storyboard-v5.jpg`
- Score: `output/soundtrack-v5.wav`
- Earlier cuts: `output/ghostloop-promo-v4.mp4`, `-v3`, `-v2`, `-v1`, with their sources in `archive/v4/` … `archive/v1/`.

## Preview

```sh
node promo/render.mjs --preview
```

Open http://127.0.0.1:5188 for play/pause, replay, scrubbing, and sound. `seekFilm(seconds)` in the console seeks the film. `REVIEW_FRAMES` lists the storyboard timestamps.

## Render and verify

Requires the repository's Playwright dependency, Google Chrome, Python 3 with numpy, and FFmpeg on PATH. Rendering is fully local.

```sh
python3 promo/audio.py
node promo/render.mjs --stills
node promo/render.mjs
ffmpeg -y -v error -pattern_type glob -i 'promo/output/v5-stills/*.png' -vf 'scale=640:360,tile=3x7:padding=6:margin=6:color=0x111111' -frames:v 1 promo/output/storyboard-v5.jpg
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,nb_frames -show_entries format=duration -of json promo/output/ghostloop-promo-v5.mp4
ffmpeg -v error -i promo/output/ghostloop-promo-v5.mp4 -f null -
```

The root README embeds a GIF of the film at `docs/media/ghostloop-promo.gif`. It is 800 px wide, 12 fps, with a 128-color palette, and comes to about 10 MB. Regenerate it after a new render:

```sh
ffmpeg -y -i promo/output/ghostloop-promo-v5.mp4 -vf "fps=12,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" -loop 0 docs/media/ghostloop-promo.gif
```

The stills pass checks:
- only one caption shows at a time;
- the upload completes and the app window opens to full size;
- every ghost enters the screen;
- all three pins appear;
- the fix makes Free the primary button;
- the count reaches zero and the brand card shows;
- the animated state is identical whether a beat is reached by seeking forward or backward;
- preview controls work and there are no browser errors.

## Edit

- `index.html`: the stage. `#frame` is the single object that is drop zone, app window, and logo ring.
- `style.css`: brand tokens, the neutral tested app, panel, pins, captions.
- `characters.js`: the ghost rig: body with waving hem, face, mouths and brows per mood, props, arms.
- `animation.js`: the GSAP timeline. `cam` is the camera. `go()` moves a ghost on an arc. `squash()` and `mood()` handle impacts and expressions. `draw()` builds every frame from timeline state.
- `audio.py`: original numpy score and sound design synced to the picture.
- `render.mjs`: local server, story checks, 60 fps capture with motion-blur blending, encode, and mux.

## Assets

GSAP 3.14.2 is vendored from npm with its license header (https://gsap.com/standard-license/). Inter is under the SIL Open Font License (`assets/INTER-LICENSE.txt`). The mascot is the dashboard's own artwork (`apps/dashboard/public/assets/ghostloop-mascot.png`). The ghost rigs, motion, UI illustration, and score are original to this project.
