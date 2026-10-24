# @ghostloop/prototype

React + Vite prototype of the Matrix Coor onboarding flow (Figma page "01 Baseline A"). It is designed at 1280×800 and fills larger viewports: the nav and gradient span the full width, the card stays centered below the nav, and `decor.sparkle` is anchored bottom-left and scales with the viewport height (exactly 630×783 at 800 px tall).

```sh
npm run dev -w @ghostloop/prototype     # http://localhost:5173 → /v/ver_baseline/signup
npm run build -w @ghostloop/prototype
npm run check -w @ghostloop/prototype   # typecheck
```

## Routes

`/v/:versionId/{signup,workspace,plan,invite,confirm}`. The version's manifest is fetched at runtime from `/designs/versions/<versionId>.json` and validated with `parseManifest` from `@ghostloop/design-engine`. An unknown, malformed or incomplete version shows an error panel (`data-testid="manifest-error"`).

## Manifests are served, not bundled

The Vite config serves the repo-root `designs/` directory at `/designs` with `Cache-Control: no-store`, in both `vite` (dev) and `vite preview`. A new candidate file such as `designs/versions/ver_abc.json` loads at `/v/ver_abc/signup` without a rebuild. Any other host for `dist/` must also serve `designs/` at `/designs`.

## Control IDs

Every Figma layer whose name contains a dot is rendered with `data-testid` equal to that name. On inputs and checkboxes, the testid is on the native control. Its label, style token, order and visibility come from the manifest. `decor.sparkle` is `aria-hidden` and ignores pointer events. The nav avatar is decorative and not interactive.

Behaviour:
- Validation is re-checked on every submit. Failures show inline (`role="alert"`, protected) and clear when that field is edited.
  - signup: name required (`signup.name.error`), valid email (`signup.email.error`), password of at least 8 characters (`signup.password.error`), consent checked (`signup.consent.error`).
  - workspace: name required (`workspace.name.error`).
  - invite: valid email (`invite.error`).
- `workspace.back`, `plan.back` and `invite.back` follow the Figma design: "←Back" just above the card (above the free plan card on plan). The arrow is decorative; the manifest label is the link text. They return to the previous screen. Entered values, including consent, are kept in memory for the session. Signup and confirm have no back link.
- `confirm.done` ends the flow; there's no dashboard yet.
