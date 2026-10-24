import type { PresentedElement, PresentedManifest } from "./manifest";

export type DiffField = "label" | "visible" | "styleToken" | "order";

export interface FieldChange {
  field: DiffField;
  from: string | number | boolean | null;
  to: string | number | boolean | null;
}

export interface ElementDiff {
  elementId: string;
  screen: string;
  changes: FieldChange[];
}

const FIELDS: DiffField[] = ["label", "visible", "styleToken", "order"];

// Absent visible means visible; other absent fields compare as null.
function valueOf(el: PresentedElement, field: DiffField): string | number | boolean | null {
  if (field === "visible") return el.visible ?? true;
  return el[field] ?? null;
}

/**
 * Presentation changes from parent to child, per element, in the child's element order. Only elements with at least
 * one change are returned. Both manifests must have the same element IDs (the manifest_ids_stable guardrail).
 */
export function diffManifests(parent: PresentedManifest, child: PresentedManifest): ElementDiff[] {
  const before = new Map(parent.elements.map((e) => [e.elementId, e]));
  const added = child.elements.filter((e) => !before.has(e.elementId)).map((e) => e.elementId);
  const childIds = new Set(child.elements.map((e) => e.elementId));
  const removed = parent.elements.filter((e) => !childIds.has(e.elementId)).map((e) => e.elementId);
  if (added.length + removed.length > 0) {
    throw new Error(`cannot diff ${parent.versionId} → ${child.versionId}: element IDs differ (added: ${added.join(", ") || "none"}; removed: ${removed.join(", ") || "none"})`);
  }
  return child.elements.flatMap((el) => {
    const old = before.get(el.elementId)!;
    const changes = FIELDS.filter((f) => valueOf(old, f) !== valueOf(el, f)).map((field) => ({ field, from: valueOf(old, field), to: valueOf(el, field) }));
    return changes.length > 0 ? [{ elementId: el.elementId, screen: el.screen, changes }] : [];
  });
}
