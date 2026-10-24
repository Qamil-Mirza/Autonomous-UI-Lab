import { z } from "zod";
import { diffManifests, type DiffField } from "./diff";
import type { PresentedManifest } from "./manifest";

// What packages/design-engine/figma/snapshot.js returns for one element layer (a layer named by element ID).
export const FigmaElementSnapshot = z.object({
  type: z.string(),
  // Effective visibility: the layer and every ancestor up to the frame are visible.
  visible: z.boolean(),
  // Characters of every TEXT node in the layer's subtree (itself included), in tree order.
  texts: z.array(z.string()),
  // Element-ID layers nested inside this one (e.g. a form group's fields).
  contains: z.array(z.string()),
  bounds: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  // Fills, strokes and type styling of the subtree, serialized; equal strings mean equal appearance.
  style: z.string(),
});
export type FigmaElementSnapshot = z.infer<typeof FigmaElementSnapshot>;

export const FigmaFrameSnapshot = z.object({
  screen: z.string().min(1),
  nodeId: z.string().min(1),
  name: z.string(),
  elements: z.record(FigmaElementSnapshot),
});
export type FigmaFrameSnapshot = z.infer<typeof FigmaFrameSnapshot>;

export const FigmaSnapshot = z.object({ fileKey: z.string().min(1), frames: z.array(FigmaFrameSnapshot) });
export type FigmaSnapshot = z.infer<typeof FigmaSnapshot>;

export const FigmaCheckKind = z.enum(["changed", "protected", "unchanged", "present"]);
export const FigmaCheck = z.object({
  elementId: z.string().min(1),
  screen: z.string(),
  frame: z.string(),
  kind: FigmaCheckKind,
  field: z.enum(["label", "visible", "styleToken", "order", "layer", "appearance"]),
  expected: z.string(),
  actual: z.string(),
  passed: z.boolean(),
  note: z.string().optional(),
});
export type FigmaCheck = z.infer<typeof FigmaCheck>;

export interface FigmaCheckResult {
  status: "verified" | "mismatch";
  checks: FigmaCheck[];
}

// Change types a Figma frame can't express faithfully. They are never faked: the check fails with this note.
export const UNSUPPORTED_IN_FIGMA: Partial<Record<DiffField, string>> = {
  styleToken: "not applied: Figma frames have no style tokens",
  order: "not applied: absolute Figma layout cannot represent manifest order",
};

// Whitespace collapsed; the decorative "←" before back-link labels is dropped (it is aria-hidden in React).
export const normalizeLabel = (s: string) => s.replace(/\s+/g, " ").trim().replace(/^←\s*/, "");

const hasLabel = (snap: FigmaElementSnapshot, label: string) => snap.texts.some((t) => normalizeLabel(t) === normalizeLabel(label));
const show = (v: unknown) => (v === null || v === undefined ? "unset" : typeof v === "string" ? JSON.stringify(v) : String(v));
const result = (checks: FigmaCheck[]): FigmaCheckResult => ({ status: checks.every((c) => c.passed) ? "verified" : "mismatch", checks });

function appearanceDiff(before: FigmaElementSnapshot, after: FigmaElementSnapshot): string[] {
  const out: string[] = [];
  if (JSON.stringify(before.texts) !== JSON.stringify(after.texts)) out.push(`texts ${JSON.stringify(before.texts)} → ${JSON.stringify(after.texts)}`);
  if (before.visible !== after.visible) out.push(`visible ${before.visible} → ${after.visible}`);
  const b = before.bounds, a = after.bounds;
  if (b.x !== a.x || b.y !== a.y || b.width !== a.width || b.height !== a.height) out.push(`bounds ${b.x},${b.y} ${b.width}×${b.height} → ${a.x},${a.y} ${a.width}×${a.height}`);
  if (before.style !== after.style) out.push("fills/strokes/type style changed");
  return out;
}

/**
 * Checks a candidate's Figma variant frames against the candidate manifest and the baseline frames:
 * every changed field shows the candidate's value, and every other element on the screen (protected ones explicitly)
 * is identical to the baseline frame. Variant frames are matched to baseline frames by screen.
 */
export function checkVariant(input: {
  parent: PresentedManifest;
  child: PresentedManifest;
  baselineFrames: readonly FigmaFrameSnapshot[];
  variantFrames: readonly FigmaFrameSnapshot[];
}): FigmaCheckResult {
  const diff = new Map(diffManifests(input.parent, input.child).map((d) => [d.elementId, d]));
  const childById = new Map(input.child.elements.map((e) => [e.elementId, e]));
  const checks: FigmaCheck[] = [];

  for (const variant of input.variantFrames) {
    const base = input.baselineFrames.find((f) => f.screen === variant.screen && !f.name.includes("--"));
    for (const el of input.parent.elements.filter((e) => e.screen === variant.screen)) {
      const snap = variant.elements[el.elementId];
      const baseSnap = base?.elements[el.elementId];
      const at = { elementId: el.elementId, screen: variant.screen, frame: variant.name };
      const change = diff.get(el.elementId);

      if (change) {
        if (!snap) {
          checks.push({ ...at, kind: "changed", field: "layer", expected: `layer ${el.elementId}`, actual: "missing", passed: false });
          continue;
        }
        for (const c of change.changes) {
          const unsupported = UNSUPPORTED_IN_FIGMA[c.field];
          if (unsupported) {
            checks.push({ ...at, kind: "changed", field: c.field, expected: show(c.to), actual: "not representable in Figma", passed: false, note: unsupported });
          } else if (c.field === "label") {
            const label = childById.get(el.elementId)!.label ?? "";
            checks.push({ ...at, kind: "changed", field: "label", expected: show(label), actual: JSON.stringify(snap.texts), passed: hasLabel(snap, label) });
          } else {
            checks.push({ ...at, kind: "changed", field: "visible", expected: show(c.to), actual: show(snap.visible), passed: snap.visible === c.to });
          }
        }
        continue;
      }

      const kind = el.protected ? "protected" : "unchanged";
      if (!baseSnap && !snap) continue; // drawn on neither frame (e.g. an alert that only appears in an --error frame)
      if (!baseSnap || !snap) {
        checks.push({ ...at, kind, field: "layer", expected: baseSnap ? "present (as in baseline)" : "absent (as in baseline)", actual: snap ? "present" : "missing", passed: false });
        continue;
      }
      // A container's texts and styles include its children's, so a changed child would show up here too. The
      // children are checked individually; the container is compared only when none of them changed.
      const changedInside = snap.contains.filter((id) => diff.has(id));
      if (changedInside.length > 0) {
        checks.push({ ...at, kind, field: "appearance", expected: `identical to ${base!.name} apart from ${changedInside.join(", ")}`, actual: "not compared as a whole", passed: true, note: `contains changed element(s) ${changedInside.join(", ")}, checked individually` });
        continue;
      }
      const diffs = appearanceDiff(baseSnap, snap);
      checks.push({ ...at, kind, field: "appearance", expected: `identical to ${base!.name}`, actual: diffs.length === 0 ? "identical" : diffs.join("; "), passed: diffs.length === 0 });
    }
  }
  return result(checks);
}

/**
 * Checks the baseline Figma frames against the baseline manifest: every element has a layer on a frame of its screen,
 * its label appears in that layer, and its visibility matches (visible on at least one frame, or hidden on all).
 * Order is not checked: absolute Figma layout cannot represent it.
 */
export function checkBaseline(input: { manifest: PresentedManifest; frames: readonly FigmaFrameSnapshot[] }): FigmaCheckResult {
  const checks: FigmaCheck[] = [];
  for (const el of input.manifest.elements) {
    const frames = input.frames.filter((f) => f.screen === el.screen && f.elements[el.elementId]);
    const at = { elementId: el.elementId, screen: el.screen, frame: frames.map((f) => f.name).join(", ") || "none" };
    const kind = "present" as const;
    if (frames.length === 0) {
      checks.push({ ...at, kind, field: "layer", expected: `layer ${el.elementId} on a ${el.screen} frame`, actual: "missing", passed: false });
      continue;
    }
    checks.push({ ...at, kind, field: "layer", expected: `layer ${el.elementId}`, actual: "present", passed: true });
    const snaps = frames.map((f) => f.elements[el.elementId]!);
    if (el.label !== undefined) {
      const label = el.label;
      checks.push({ ...at, kind, field: "label", expected: show(label), actual: JSON.stringify([...new Set(snaps.flatMap((s) => s.texts))]), passed: snaps.some((s) => hasLabel(s, label)) });
    }
    const expectedVisible = el.visible ?? true;
    const actualVisible = snaps.some((s) => s.visible);
    checks.push({ ...at, kind, field: "visible", expected: show(expectedVisible), actual: show(actualVisible), passed: expectedVisible === actualVisible });
  }
  return result(checks);
}
