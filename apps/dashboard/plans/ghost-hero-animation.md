# Ghostlike hero animation

## Goal
Make the landing hero feel haunted: the mascot gently floats, and the coral loops behind it slowly drift and fade like ghostly trails. Calm, continuous, and never distracting from the headline or the "Open dashboard" button.

## Decisions
- **Style:** gentle float plus fading loop trails.
- **Timing:** loops continuously and slowly.
- **Implementation:** CSS only, no new dependency. Changes go in `src/index.css`; no JSX changes needed (`.hero-art`, `.loop-one`, `.loop-two` and `.mascot` already exist in `src/App.tsx`).
- **Mascot appearance:** the image itself is not altered (no filters on colors or shape). Only its position moves, plus its existing drop shadow.

## Motion spec
Use the existing tokens (`--ease-out`), and add `--ease-float: cubic-bezier(.45,0,.55,1)` for a smooth back-and-forth.

1. **Mascot float** (`.mascot`)
   - Up and down by 10px, plus a tiny ±1° sway.
   - 6s per cycle, infinite, alternating, `--ease-float`.
   - Starts after the existing `mascotIn` entrance finishes (delay of about 400ms) so the two don't conflict. Put the float on `.mascot` (inside `.hero-art`) so it doesn't fight the `.hero-art` entrance transform.
2. **Shadow breathing** (`.hero-art::after`, new pseudo-element)
   - A soft, blurred ellipse under the mascot.
   - Scales down (from 1 to about 0.85) and fades a little while the mascot rises, in sync with the 6s float.
   - Replace the mascot's current `drop-shadow` with this ground shadow so the "hovering" feeling reads clearly.
3. **Loop trails** (`.loop-one`, `.loop-two`)
   - Slow rotation drift of ±6° around each loop's current base angle.
   - Opacity breathes between 0.35 and 0.7.
   - `.loop-one`: 9s cycle. `.loop-two`: 12s cycle, offset by −4s so the two never move together.
   - Keep each loop's existing base rotation in every keyframe (−15° and 18°) so their positions stay intact.

## Constraints
- Animate only `transform` and `opacity`. Use `will-change: transform` on `.mascot` only.
- Keep the layout stable: no size changes. `.hero-art` already has `overflow: hidden`, so loops can't cause horizontal scroll.
- Keep the headline and button readable and static once their entrance finishes.
- **Reduced motion:** wrap all of this in `@media (prefers-reduced-motion: no-preference)`. With reduced motion on, everything stays still at its resting pose: mascot at rest, loops at their base angle and opacity 0.6.
- Pause when not visible is optional; CSS animations already throttle in background tabs.

## Edge cases
- **Mobile (≤620px):** cut the float to 6px and stop the loop rotation, keeping only the opacity breathing. This avoids busy motion in a small space.
- Make sure the float doesn't overlap the hero copy at the 900px breakpoint, where the hero stacks into one column.

## Verification
1. `pnpm format && pnpm build`.
2. In headless Chromium, screenshot the landing page at 1440×900 and 390×844 at t≈0.5s and t≈3.5s. The mascot should be at a different height in the two shots, with no clipping or overflow.
3. Emulate `prefers-reduced-motion: reduce` and confirm everything renders static.
4. Confirm the dashboard is unaffected, since all selectors are scoped to the hero.
