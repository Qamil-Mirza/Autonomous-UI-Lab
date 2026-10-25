# COMPATIBILITY FIXTURE — not an actual Figma Make export

This small app was written by hand to mimic the layout of a Figma Make code export (Vite + React, `vite.config.ts`
with versioned-import aliases and `outDir: "build"`, `src/App.tsx`, `src/components/ui/*`, `guidelines/`,
`src/Attributions.md`) so GhostLoop's import path can be exercised end to end. Validation against a real Figma
Make export is still outstanding.

`npm run fixture:zip -w @ghostloop/importer` packs it as `fixtures/northwind-make-export.zip`, inside a single
wrapper directory as a downloaded export would be.

The app: a coffee pickup order. Menu (`/`) → bag (`/bag`) → details (`/checkout`) → confirmation
(`/order/confirmed`). The bag is kept in `localStorage`, so tests can confirm runs do not share state.

**Deliberate defect.** On the bag page the primary button reads "Continue" but returns to the menu, and the way to
checkout is a secondary button labeled "Save bag". This gives the simulator real friction and gives GhostLoop a
wording change that could fix it.
