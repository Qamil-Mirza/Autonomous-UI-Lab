import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { MutationPatch } from "@ghostloop/contracts";
import { diffManifests, parseManifest, type PresentedManifest } from "../src";
import { applyPatches } from "../src/patch";

const baselinePath = new URL("../../../designs/versions/ver_baseline.json", import.meta.url);
const baseline = (): PresentedManifest => parseManifest(JSON.parse(readFileSync(baselinePath, "utf8")));

const edit = (m: PresentedManifest, id: string, fields: Record<string, unknown>): PresentedManifest => ({
  ...m,
  versionId: "ver_child",
  elements: m.elements.map((e) => (e.elementId === id ? { ...e, ...fields } : e)),
});

let n = 0;
function patch(targetElementId: string, op: MutationPatch["op"], value: unknown): MutationPatch {
  return {
    schemaVersion: "1.0.0",
    id: `pat_diff${++n}`,
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
  } as MutationPatch;
}

describe("diffManifests", () => {
  it("returns nothing for identical manifests", () => {
    expect(diffManifests(baseline(), baseline())).toEqual([]);
  });

  it("reports label, visible, styleToken and order changes with from/to", () => {
    const child = edit(baseline(), "plan.free.cta", { label: "Pick Free", visible: false, styleToken: "button.primary", order: 9 });
    const base = baseline().elements.find((e) => e.elementId === "plan.free.cta")!;
    expect(diffManifests(baseline(), child)).toEqual([
      {
        elementId: "plan.free.cta",
        screen: "plan",
        changes: [
          { field: "label", from: base.label, to: "Pick Free" },
          { field: "visible", from: true, to: false },
          { field: "styleToken", from: base.styleToken ?? null, to: "button.primary" },
          { field: "order", from: base.order ?? null, to: 9 },
        ],
      },
    ]);
  });

  it("treats an absent visible as true", () => {
    const parent = edit(baseline(), "plan.title", { visible: undefined });
    const child = edit(baseline(), "plan.title", { visible: true });
    expect(diffManifests(parent, child)).toEqual([]);
  });

  it("throws when element IDs differ", () => {
    const child = { ...baseline(), elements: baseline().elements.filter((e) => e.elementId !== "plan.title") };
    expect(() => diffManifests(baseline(), child)).toThrow(/element IDs differ.*removed: plan\.title/);
  });

  it("gives exactly the demo candidates' changes", () => {
    const label = patch("plan.free.cta", "set_label", "Continue with Free plan");
    const note = patch("plan.free.note", "set_visibility", true);
    const b = applyPatches(baseline(), [label]);
    const c = applyPatches(baseline(), [label, note]);
    const labelDiff = { elementId: "plan.free.cta", screen: "plan", changes: [{ field: "label", from: "Continue", to: "Continue with Free plan" }] };
    expect(diffManifests(baseline(), b)).toEqual([labelDiff]);
    expect(diffManifests(baseline(), c)).toEqual([
      { elementId: "plan.free.note", screen: "plan", changes: [{ field: "visible", from: false, to: true }] },
      labelDiff,
    ]);
  });
});
