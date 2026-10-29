# GhostLoop Promo Implementation Plan

**Goal:** Render the approved 40-second GhostLoop promo as an editable GSAP animation and a 1080p MP4 with original audio.

**Architecture:** A standalone HTML stage contains vector ghosts and simplified product UI. A paused GSAP timeline controls all animation. Playwright seeks the timeline at exact frame timestamps and pipes frames to FFmpeg; a small synthesizer produces the audio bed.

**Tech Stack:** GSAP, HTML/CSS/SVG, Playwright, Node.js, Python standard library, FFmpeg.

Execution is inline in this session; the user has approved building and rendering the complete deliverable.

1. [x] Create `promo/index.html`, `promo/style.css`, and `promo/animation.js`, with a 1920×1080 stage, the six requested narrative steps, opening/closing titles, and usable playback controls.
2. [x] Vendor GSAP and Inter fonts under `promo/assets/` for offline rendering. Add attribution and reproducible setup instructions.
3. [x] Create `promo/render.mjs` to serve local assets, capture selected review frames or all 1200 frames, and encode H.264 video. Fail on browser errors or encoder failure.
4. [x] Create `promo/audio.py` to synthesize an original 40-second stereo instrumental bed and scene accents. Mix and normalize it with FFmpeg into the final MP4.
5. [x] Capture scene samples, build a contact sheet, visually inspect at full size, and fix any cropping, illegibility, or timing problems.
6. [x] Render the final MP4. Run `ffprobe` to verify 1920×1080, 30fps, 40 seconds, H.264/AAC, and run a complete FFmpeg decode check.
7. [x] Write `promo/README.md` with preview/render commands and clearly identify the displayed results as illustrative. Deliver video, contact sheet, and editable source.

No application source or runtime behavior needs changing. Verification focuses on the resulting media and rendering pipeline rather than adding application tests for a standalone creative artifact.
