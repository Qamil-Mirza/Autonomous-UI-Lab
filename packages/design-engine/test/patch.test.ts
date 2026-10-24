import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DesignManifest, type MutationPatch } from "@ghostloop/contracts";
import { parseManifest, type PresentedManifest } from "../src";
import { applyPatches, computeManifestHash, PatchError } from "../src/patch";

const baselinePath = new URL("../../../designs/versions/ver_baseline.json", import.meta.url);
const baseline = (): PresentedManifest => parseManifest(JSON.parse(readFileSync(baselinePath, "utf8")));

let n = 0;
function patch(targetElementId: string, op: MutationPatch["op"], value: unknown, extra: Partial<MutationPatch> = {}): MutationPatch {
  return {
    schemaVersion: "1.0.0",
    id: `pat_test${++n}`,
    experimentId: "exp_test",
    round: 1,
    sourceVersionId: "ver_baseline",
    targetElementId,
    op,
    value,
    observationIds: ["obs_1"],
    rationale: "test",
    risk: "review_required",
    state: "approved",
    ...extra,
  } as MutationPatch;
}

const el = (m: PresentedManifest, id: string) => m.elements.find((e) => e.elementId === id)!;

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

// The baseline has no set_order support; enable it on the plan heading for reorder tests.
function withOrderOps(ids: string[]): PresentedManifest {
  const m = baseline();
  return { ...m, elements: m.elements.map((e) => (ids.includes(e.elementId) ? { ...e, supportedOps: [...e.supportedOps, "set_order"] } : e)) };
}

function expectPatchError(fn: () => unknown, code: string, message: RegExp) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(PatchError);
    expect((err as PatchError).code).toBe(code);
    expect((err as Error).message).toMatch(message);
    return;
  }
  throw new Error("expected applyPatches to throw");
}

describe("applyPatches", () => {
  it("applies a label patch into a new version with lineage, patch IDs and a recomputed hash", () => {
    const source = deepFreeze(baseline());
    const before = JSON.stringify(source);
    const p = patch("plan.free.cta", "set_label", "Continue with Free plan");
    const out = applyPatches(source, [p]);

    expect(out.versionId).toMatch(/^ver_[0-9a-f]{12}$/);
    expect(out.versionId).not.toBe("ver_baseline");
    expect(out.parentVersionId).toBe("ver_baseline");
    expect(out.patchIds).toEqual([p.id]);
    expect(el(out, "plan.free.cta").label).toBe("Continue with Free plan");
    expect(out.manifestHash).toBe(computeManifestHash(out.elements));
    expect(out.manifestHash).not.toBe(source.manifestHash);
    expect(DesignManifest.safeParse(out).success).toBe(true);
    // Only the target changed, and the source is untouched.
    expect(out.elements.filter((e, i) => JSON.stringify(e) !== JSON.stringify(source.elements[i])).map((e) => e.elementId)).toEqual(["plan.free.cta"]);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("matches the baseline's own hash rule", () => {
    const m = baseline();
    expect(computeManifestHash(m.elements)).toBe(m.manifestHash);
  });

  it("applies style token and visibility patches", () => {
    const out = applyPatches(baseline(), [
      patch("plan.free.cta", "set_style_token", "button.primary"),
      patch("plan.free.note", "set_visibility", true),
    ]);
    expect(el(out, "plan.free.cta").styleToken).toBe("button.primary");
    expect(el(out, "plan.free.note").visible).toBe(true);
  });

  it("gives every call a fresh version ID", () => {
    const p = [patch("plan.free.cta", "set_label", "Go free")];
    const ids = new Set([applyPatches(baseline(), p).versionId, applyPatches(baseline(), p).versionId]);
    expect(ids.size).toBe(2);
    expect(applyPatches(baseline(), p, { newVersionId: () => "ver_fixed" }).versionId).toBe("ver_fixed");
  });

  it("reorders within a render group using the group's slots", () => {
    const out = applyPatches(withOrderOps(["plan.title", "plan.helper"]), [patch("plan.helper", "set_order", 1)]);
    expect(el(out, "plan.helper").order).toBe(1);
    expect(el(out, "plan.title").order).toBe(2);
    // Other groups keep their slots.
    expect(el(out, "plan.back").order).toBe(0);
    expect(el(out, "plan.free.price").order).toBe(3);
  });
});

describe("applyPatches rejects", () => {
  it("a stale source version", () => {
    expectPatchError(() => applyPatches(baseline(), [patch("plan.free.cta", "set_label", "x", { sourceVersionId: "ver_other" })]), "stale_source", /targets ver_other but the source is ver_baseline/);
  });

  it("an unknown target element", () => {
    expectPatchError(() => applyPatches(baseline(), [patch("plan.compare.link", "set_label", "x")]), "unknown_element", /no element plan\.compare\.link in ver_baseline/);
  });

  it("plan.free.price set_label: protected pricing", () => {
    expectPatchError(() => applyPatches(baseline(), [patch("plan.free.price", "set_label", "Free forever")]), "protected_element", /plan\.free\.price is protected \(pricing\)/);
  });

  it("signup.submit: protected signup", () => {
    expectPatchError(() => applyPatches(baseline(), [patch("signup.submit", "set_label", "Go")]), "protected_element", /signup\.submit is protected \(signup\)/);
  });

  it("an op the element does not support", () => {
    expectPatchError(() => applyPatches(baseline(), [patch("plan.title", "set_style_token", "button.primary")]), "unsupported_op", /plan\.title does not support set_style_token \(supports: set_label\)/);
    expectPatchError(() => applyPatches(baseline(), [patch("plan.title", "set_visibility", false)]), "unsupported_op", /does not support set_visibility/);
  });

  it("blocked risk, blocked state and declined state", () => {
    expectPatchError(
      () => applyPatches(baseline(), [patch("plan.free.cta", "set_label", "x", { risk: "blocked", state: "proposed", blockReason: "policy says no" })]),
      "not_applicable",
      /risk is blocked \(policy says no\)/,
    );
    expectPatchError(() => applyPatches(baseline(), [patch("plan.free.cta", "set_label", "x", { state: "blocked" })]), "not_applicable", /state is blocked/);
    expectPatchError(() => applyPatches(baseline(), [patch("plan.free.cta", "set_label", "x", { state: "declined" })]), "not_applicable", /state is declined/);
  });

  it("a style token outside the approved set", () => {
    expectPatchError(() => applyPatches(baseline(), [patch("plan.free.cta", "set_style_token", "button.neon")]), "invalid_value", /style token "button\.neon" is not approved/);
  });

  it("blank or overlong labels", () => {
    expectPatchError(() => applyPatches(baseline(), [patch("plan.free.cta", "set_label", "   ")]), "invalid_value", /label is blank/);
    expectPatchError(() => applyPatches(baseline(), [patch("plan.free.cta", "set_label", "x".repeat(121))]), "invalid_value", /121 characters \(max 120\)/);
  });

  it("a non-boolean visibility", () => {
    expectPatchError(() => applyPatches(baseline(), [patch("plan.free.note", "set_visibility", "yes")]), "invalid_value", /malformed: value: Expected boolean/);
  });

  it("an order outside the element's render group", () => {
    const m = withOrderOps(["plan.title", "plan.helper"]);
    expectPatchError(() => applyPatches(m, [patch("plan.helper", "set_order", 5)]), "invalid_value", /order 5 is out of range for render group plan\.heading \(slots: 1, 2\)/);
  });

  it("an element that is in no render group", () => {
    const m = withOrderOps(["plan.free.cta"]);
    expectPatchError(() => applyPatches(m, [patch("plan.free.cta", "set_order", 0)]), "invalid_value", /plan\.free\.cta is not in a reorderable render group/);
  });

  it("a reorder that would move a protected element", () => {
    const m = withOrderOps(["signup.title"]);
    expectPatchError(() => applyPatches(m, [patch("signup.title", "set_order", 4)]), "invalid_value", /change the order of protected element signup\.name/);
  });

  it("a reorder that would change the workflow order", () => {
    const m = baseline();
    // An unprotected interactive pair, so only the workflow rule can catch it.
    const fields = { ...m, elements: m.elements.map((e) => (e.screen === "workspace" && ["workspace.name", "workspace.continue"].includes(e.elementId) ? { ...e, protected: false, supportedOps: [...e.supportedOps, "set_order" as const] } : e)) };
    expectPatchError(() => applyPatches(fields, [patch("workspace.continue", "set_order", 4)]), "invalid_value", /workflow order of workspace\.fields \(workspace\.name → workspace\.continue became workspace\.continue → workspace\.name\)/);
  });

  it("two patches on the same element and op", () => {
    expectPatchError(
      () => applyPatches(baseline(), [patch("plan.free.cta", "set_label", "A"), patch("plan.free.cta", "set_label", "B")]),
      "conflict",
      /another patch already applies set_label to plan\.free\.cta/,
    );
  });

  it("duplicate patch IDs", () => {
    const a = patch("plan.free.cta", "set_label", "A");
    expectPatchError(() => applyPatches(baseline(), [a, { ...a, targetElementId: "plan.title" }]), "conflict", /duplicate patch id/);
  });

  it("without producing anything when a later patch is bad", () => {
    const source = deepFreeze(baseline());
    expect(() => applyPatches(source, [patch("plan.free.cta", "set_label", "ok"), patch("signup.submit", "set_label", "no")])).toThrow(PatchError);
    expect(el(source, "plan.free.cta").label).toBe("Continue");
  });
});
