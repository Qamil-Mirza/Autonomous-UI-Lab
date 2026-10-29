# GhostLoop promo v5: brand colors and real motion

User request: improve on promo v3 (the animated ghost story), which "doesn't use the brand colors and does not do motion well". The launch film in `promo/launch/` (real-UI screenshots) is not what they wanted. Keep v3's story and its playful animated-ghost approach. Shorter is better.

## What was wrong with v3 (from frame strips at 3 fps)

- Palette is forest green, sage, and purple/green cartoon ghosts; wordmark "GhostLoop." Not the product's brand.
- No camera. The app sits small (about 30% of frame) and centered nearly the whole film.
- Long dead holds: upload card, friction, "You're in", end card each sit almost still for 3–5 s.
- Beats cross-fade instead of transforming one object into the next.
- Ghosts slide as flat stickers: no anticipation, squash and stretch, follow-through, blinking, or gaze.

## Brand (from `apps/dashboard/src/index.css` and the mascot)

Cream `#f7f7f2`, ink `#17201d`, muted `#66716c`, line `#dde2dc`, coral `#ee7375`, coral-dark `#c84f57`, sidebar ink `#202825`, soft coral wash `#fde8e5`, green `#246d54` only for success. Inter. Lowercase `ghostloop` with coral "oo". Mascot: white body, thick black hand-drawn line, coral cheeks.

## Direction

- Ghosts are line art in the mascot's style: white, ink stroke, coral cheeks. Personality comes from small props and behavior, not fill color.
- The tested app is neutral (white, line gray, ink buttons) so GhostLoop's coral annotations are the only accent. The friction is real and recognizable: the paid "Start free trial" is the loud primary button; the Free plan's "Continue" is a quiet outline.
- The swarm section goes ink (`#202825`) instead of green.
- One camera over one world. Every beat transforms the previous object.

## Motion system

- Camera: a `#world` layer with tweened x, y, scale; pushes, pulls and whip pans with motion blur.
- Ghosts are drawn every frame from timeline-owned models (position, scale, squash, rotation, gaze, blink, mood). Hem waves and idle bob derive from timeline time, so scrubbing and rendering match.
- Anticipation before every jump, squash on landing, stretch along fast paths, overshoot settles, staggered overlap.
- Paths are arcs (cubic Béziers evaluated in the draw step), never straight slides.
- Kinetic captions: words rise through a mask, coral emphasis, exit upward.
- Motion blur: render at 60 fps and blend frame pairs with FFmpeg `tmix`, output 30 fps.

## Sequence (30 s, 1920×1080)

| Time | Beat | Caption |
| --- | --- | --- |
| 0–3 | A zip file arcs in and drops into a coral dashed drop zone; the zone gulps (squash), a coral ring fills, check pops | Drop in your app. |
| 3–6 | The drop zone FLIP-expands into the app window; skeleton blocks snap into a plan picker | We build it. |
| 6–9.5 | Circular ink wipe; the app pulls back; three hero ghosts pop up from behind its edge with name chips, then nine small ghosts | Meet your testers. |
| 9.5–12.5 | Ghosts orbit in 3D (behind and in front of the window), accelerate, and dive into the screen | AI users, real browser. |
| 12.5–17.5 | Cream returns; camera pushes in; ghosts drift to the loud paid-trial button, bonk, frown; one loops back and forth; coral pins pop | See where they get stuck. |
| 17.5–21 | Pins fly out and become two suggestion cards; cursor presses Approve; ripple | You approve every fix. |
| 21–25 | Fixes fly into the UI: the Free button becomes primary "Continue with Free"; ghosts glide through, happy; "3 → 0 stuck points" (illustrative) | Then we test it again. |
| 25–30 | The window collapses into the coral loop of the wordmark; ghosts slingshot through it; mascot lands; tagline; hold | ghostloop · Your first users, before your first real user. |

## Steps

- [x] Archive v4 source to `promo/archive/v4/`.
- [x] Write `characters.js` (rigged line-art ghost), `index.html`, `style.css`, `animation.js`.
- [x] Update `render.mjs` for v5: 60 fps capture, `tmix` motion blur, story checks.
- [x] Write the v5 score in `audio.py`, synced to the new beats.
- [x] Stills review and motion-strip review; fix.
- [x] Render, probe, full decode, contact sheet; update `promo/README.md`.
