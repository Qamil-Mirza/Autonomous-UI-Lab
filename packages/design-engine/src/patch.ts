import { createHash } from "node:crypto";
import { MutationPatch, newId, type VersionId } from "@ghostloop/contracts";
import { groupOf, INTERACTIVE_ROLES, RENDER_GROUPS } from "./groups";
import { PresentedManifest, StyleToken, type PresentedElement } from "./manifest";

export const MAX_LABEL_LENGTH = 120;

export type PatchErrorCode =
  | "invalid_patch"
  | "stale_source"
  | "not_applicable"
  | "unknown_element"
  | "protected_element"
  | "unsupported_op"
  | "invalid_value"
  | "conflict";

export class PatchError extends Error {
  constructor(
    readonly code: PatchErrorCode,
    readonly patchId: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "PatchError";
  }
}

// Hash fields in a fixed order so schema parsing and object insertion order do not change identity.
export function computeManifestHash(elements: readonly PresentedElement[]): string {
  const canonical = elements.map(e => ({
    elementId: e.elementId, screen: e.screen, role: e.role, label: e.label,
    protected: e.protected, categories: e.categories, supportedOps: e.supportedOps,
    styleToken: e.styleToken, order: e.order, visible: e.visible,
  }));
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`;
}

export interface ApplyPatchesOptions {
  newVersionId?: () => VersionId;
}

/**
 * Deterministically applies approved patches to a design version, producing a new immutable version.
 * Every patch is validated before any is applied; the first problem throws a PatchError, so there is never a
 * partial result. `source` is never mutated.
 */
export function applyPatches(source: PresentedManifest, patches: readonly MutationPatch[], options: ApplyPatchesOptions = {}): PresentedManifest {
  const base = PresentedManifest.parse(source);
  const byId = new Map(base.elements.map((el) => [el.elementId, el]));
  const seenIds = new Set<string>();
  const seenTargets = new Set<string>();

  const valid = patches.map((input, index) => {
    const parsed = MutationPatch.safeParse(input);
    const rawId = (input as { id?: unknown } | null)?.id;
    const label = typeof rawId === "string" ? `patch ${rawId}` : `patches[${index}]`;
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
      // A wrongly typed value (e.g. non-boolean visibility) is an invalid value; anything else is a malformed patch.
      const valueOnly = parsed.error.issues.every((i) => i.path[0] === "value");
      throw new PatchError(valueOnly ? "invalid_value" : "invalid_patch", typeof rawId === "string" ? rawId : undefined, `${label} is malformed: ${issues}`);
    }
    const p = parsed.data;
    const fail = (code: PatchErrorCode, why: string): never => {
      throw new PatchError(code, p.id, `patch ${p.id} (${p.op} ${p.targetElementId}): ${why}`);
    };

    if (p.sourceVersionId !== base.versionId) fail("stale_source", `targets ${p.sourceVersionId} but the source is ${base.versionId}`);
    if (p.risk === "blocked" || p.state === "blocked" || p.state === "declined") {
      const why = p.risk === "blocked" && p.state !== "declined" ? "risk is blocked" : `state is ${p.state}`;
      fail("not_applicable", `${why}${p.blockReason ? ` (${p.blockReason})` : ""}`);
    }
    const el = byId.get(p.targetElementId) ?? fail("unknown_element", `no element ${p.targetElementId} in ${base.versionId}`);
    if (el.protected) {
      fail("protected_element", `${el.elementId} is protected${el.categories.length > 0 ? ` (${el.categories.join(", ")})` : ""}`);
    }
    if (!el.supportedOps.includes(p.op)) {
      fail("unsupported_op", `${el.elementId} does not support ${p.op} (supports: ${el.supportedOps.join(", ") || "none"})`);
    }
    checkValue(p, el, base, fail);

    if (seenIds.has(p.id)) fail("conflict", `duplicate patch id ${p.id}`);
    const target = `${p.targetElementId}\u0000${p.op}`;
    if (seenTargets.has(target)) fail("conflict", `another patch already applies ${p.op} to ${p.targetElementId}`);
    seenIds.add(p.id);
    seenTargets.add(target);
    return p;
  });

  let elements = structuredClone(base.elements);
  for (const p of valid) elements = apply(elements, p);

  // Re-check orders after all patches: sequential set_order patches in one group must still respect the rules.
  for (const p of valid) if (p.op === "set_order") checkOrderInvariants(base.elements, elements, p);

  const result: PresentedManifest = {
    schemaVersion: base.schemaVersion,
    versionId: (options.newVersionId ?? (() => newId("ver")))(),
    parentVersionId: base.versionId,
    manifestHash: computeManifestHash(elements),
    patchIds: valid.map((p) => p.id),
    elements,
  };
  return PresentedManifest.parse(result);
}

function checkValue(p: MutationPatch, el: PresentedElement, base: PresentedManifest, fail: (code: PatchErrorCode, why: string) => never): void {
  switch (p.op) {
    case "set_label":
      if (p.value.trim().length === 0) fail("invalid_value", "label is blank");
      if (p.value.length > MAX_LABEL_LENGTH) fail("invalid_value", `label is ${p.value.length} characters (max ${MAX_LABEL_LENGTH})`);
      return;
    case "set_style_token":
      if (!StyleToken.safeParse(p.value).success) {
        fail("invalid_value", `style token "${p.value}" is not approved (allowed: ${StyleToken.options.join(", ")})`);
      }
      return;
    case "set_visibility":
      return; // the boolean type is enforced by the MutationPatch parse
    case "set_order": {
      const group = groupOf(el.elementId) ?? fail("invalid_value", `${el.elementId} is not in a reorderable render group`);
      const slots = groupSlots(base.elements, group);
      if (slots.length < 2) fail("invalid_value", `render group ${group} has a single element`);
      if (!slots.includes(p.value)) {
        fail("invalid_value", `order ${p.value} is out of range for render group ${group} (slots: ${slots.join(", ")})`);
      }
      return;
    }
  }
}

function membersOf(elements: readonly PresentedElement[], group: keyof typeof RENDER_GROUPS): PresentedElement[] {
  const ids = RENDER_GROUPS[group] as readonly string[];
  return elements
    .filter((e) => ids.includes(e.elementId))
    .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || ids.indexOf(a.elementId) - ids.indexOf(b.elementId));
}

function groupSlots(elements: readonly PresentedElement[], group: keyof typeof RENDER_GROUPS): number[] {
  return membersOf(elements, group)
    .map((e) => e.order)
    .filter((o): o is number => o !== undefined);
}

function apply(elements: PresentedElement[], p: MutationPatch): PresentedElement[] {
  const set = (fields: Partial<PresentedElement>) => elements.map((e) => (e.elementId === p.targetElementId ? { ...e, ...fields } : e));
  switch (p.op) {
    case "set_label":
      return set({ label: p.value });
    case "set_style_token":
      return set({ styleToken: p.value as StyleToken });
    case "set_visibility":
      return set({ visible: p.value });
    case "set_order": {
      // Move the element into the target slot; members in between shift one slot. Slot values are reused, so
      // orders outside the group are untouched.
      const group = groupOf(p.targetElementId)!;
      const members = membersOf(elements, group);
      const slots = members.map((e) => e.order!);
      const sequence = members.filter((e) => e.elementId !== p.targetElementId);
      sequence.splice(slots.indexOf(p.value), 0, members.find((e) => e.elementId === p.targetElementId)!);
      const newOrder = new Map(sequence.map((e, i) => [e.elementId, slots[i]!]));
      return elements.map((e) => (newOrder.has(e.elementId) ? { ...e, order: newOrder.get(e.elementId)! } : e));
    }
  }
}

function checkOrderInvariants(before: readonly PresentedElement[], after: readonly PresentedElement[], p: MutationPatch): void {
  const fail = (why: string): never => {
    throw new PatchError("invalid_value", p.id, `patch ${p.id} (set_order ${p.targetElementId}): ${why}`);
  };
  const group = groupOf(p.targetElementId)!;
  const was = new Map(before.map((e) => [e.elementId, e]));
  for (const e of membersOf(after, group)) {
    const old = was.get(e.elementId)!;
    if (old.protected && old.order !== e.order) fail(`moving it would change the order of protected element ${e.elementId}`);
  }
  const interactive = (els: readonly PresentedElement[]) =>
    membersOf(els, group)
      .filter((e) => INTERACTIVE_ROLES.includes(e.role))
      .map((e) => e.elementId);
  const pre = interactive(before);
  const post = interactive(after);
  if (pre.join() !== post.join()) fail(`it would change the workflow order of ${group} (${pre.join(" → ")} became ${post.join(" → ")})`);
}
