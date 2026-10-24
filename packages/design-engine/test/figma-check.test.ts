import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkBaseline, checkVariant, FigmaSnapshot, normalizeLabel, parseManifest, type FigmaFrameSnapshot, type PresentedManifest } from "../src";

const baselinePath = new URL("../../../designs/versions/ver_baseline.json", import.meta.url);
const baseline = (): PresentedManifest => parseManifest(JSON.parse(readFileSync(baselinePath, "utf8")));
// A read-back of "01 Baseline A" taken with figma/snapshot.js.
const snapshot = (): FigmaSnapshot => FigmaSnapshot.parse(JSON.parse(readFileSync(new URL("./fixtures/figma-baseline-snapshot.json", import.meta.url), "utf8")));
const planFrame = () => snapshot().frames.find((f) => f.name === "plan")!;

const edit = (m: PresentedManifest, fields: Record<string, Record<string, unknown>>): PresentedManifest => ({
  ...m,
  versionId: "ver_child",
  elements: m.elements.map((e) => (fields[e.elementId] ? { ...e, ...fields[e.elementId] } : e)),
});

// Candidate C: the free CTA relabelled and the "No card required" note shown.
const candidateC = () => edit(baseline(), { "plan.free.cta": { label: "Continue with Free plan" }, "plan.free.note": { visible: true } });

// The variant as Claude Code draws it: duplicate the plan frame, then apply the change to each layer.
function variantOf(frame: FigmaFrameSnapshot, mutate: (els: FigmaFrameSnapshot["elements"]) => void): FigmaFrameSnapshot {
  const copy: FigmaFrameSnapshot = structuredClone({ ...frame, nodeId: "50:1", name: "plan · ver_child" });
  mutate(copy.elements);
  return copy;
}
const drawC = (els: FigmaFrameSnapshot["elements"]) => {
  els["plan.free.cta"]!.texts = ["Continue with Free plan"];
  els["plan.free.cta"]!.bounds.width = 160;
  els["plan.free.note"]!.visible = true;
};

const run = (child: PresentedManifest, variant: FigmaFrameSnapshot) =>
  checkVariant({ parent: baseline(), child, baselineFrames: snapshot().frames, variantFrames: [variant] });

describe("checkVariant", () => {
  it("verifies a variant that shows exactly the candidate's changes", () => {
    const r = run(candidateC(), variantOf(planFrame(), drawC));
    expect(r.status).toBe("verified");
    const changed = r.checks.filter((c) => c.kind === "changed");
    expect(changed.map((c) => [c.elementId, c.field])).toEqual([
      ["plan.free.note", "visible"],
      ["plan.free.cta", "label"],
    ]);
    const protectedIds = r.checks.filter((c) => c.kind === "protected").map((c) => c.elementId);
    expect(protectedIds).toEqual(expect.arrayContaining(["plan.free.price", "plan.pro.price", "plan.pro.note"]));
  });

  it("reports a wrong label", () => {
    const r = run(candidateC(), variantOf(planFrame(), (els) => { drawC(els); els["plan.free.cta"]!.texts = ["Continue with Free"]; }));
    expect(r.status).toBe("mismatch");
    expect(r.checks.filter((c) => !c.passed)).toEqual([
      expect.objectContaining({ elementId: "plan.free.cta", field: "label", expected: '"Continue with Free plan"', actual: '["Continue with Free"]' }),
    ]);
  });

  it("reports a note left hidden", () => {
    const r = run(candidateC(), variantOf(planFrame(), (els) => { drawC(els); els["plan.free.note"]!.visible = false; }));
    expect(r.checks.filter((c) => !c.passed)).toEqual([expect.objectContaining({ elementId: "plan.free.note", field: "visible", expected: "true", actual: "false" })]);
  });

  it("reports an edited protected price", () => {
    const r = run(candidateC(), variantOf(planFrame(), (els) => { drawC(els); els["plan.pro.price"]!.texts = ["$10 / user / month"]; }));
    expect(r.status).toBe("mismatch");
    expect(r.checks.filter((c) => !c.passed)).toEqual([
      expect.objectContaining({ elementId: "plan.pro.price", kind: "protected", field: "appearance", actual: expect.stringContaining('["$10 / user / month"]') }),
    ]);
  });

  it("reports an accidental edit to an unprotected element", () => {
    const r = run(candidateC(), variantOf(planFrame(), (els) => { drawC(els); els["plan.title"]!.bounds.y += 4; }));
    expect(r.checks.filter((c) => !c.passed)).toEqual([expect.objectContaining({ elementId: "plan.title", kind: "unchanged", field: "appearance" })]);
  });

  it("reports a missing changed layer", () => {
    const r = run(candidateC(), variantOf(planFrame(), (els) => { drawC(els); delete els["plan.free.note"]; }));
    expect(r.checks.filter((c) => !c.passed)).toEqual([expect.objectContaining({ elementId: "plan.free.note", field: "layer", actual: "missing" })]);
  });

  it("marks a style-token change unsupported instead of faking it", () => {
    const child = edit(baseline(), { "plan.free.cta": { styleToken: "button.primary" } });
    const r = run(child, variantOf(planFrame(), () => {}));
    expect(r.status).toBe("mismatch");
    expect(r.checks.filter((c) => !c.passed)).toEqual([
      expect.objectContaining({ elementId: "plan.free.cta", field: "styleToken", passed: false, note: "not applied: Figma frames have no style tokens" }),
    ]);
  });

  it("compares a container only when none of its children changed", () => {
    const frame = snapshot().frames.find((f) => f.name === "workspace")!;
    const child = edit(baseline(), { "workspace.continue": { label: "Next" } });
    const variant = variantOf(frame, (els) => {
      els["workspace.continue"]!.texts = ["Next"];
      els["workspace.form"]!.texts = els["workspace.form"]!.texts.map((t) => (t === "Continue" ? "Next" : t));
    });
    const r = checkVariant({ parent: baseline(), child, baselineFrames: snapshot().frames, variantFrames: [variant] });
    expect(r.status).toBe("verified");
    expect(r.checks.find((c) => c.elementId === "workspace.form")?.note).toMatch(/contains changed element\(s\) workspace\.continue/);
  });
});

describe("checkBaseline", () => {
  it("verifies the baseline frames against the baseline manifest", () => {
    const r = checkBaseline({ manifest: baseline(), frames: snapshot().frames });
    expect(r.status).toBe("verified");
    // Error elements are found in the --error frames.
    expect(r.checks.find((c) => c.elementId === "signup.consent.error" && c.field === "layer")?.frame).toBe("signup--error");
  });

  it("reports label drift and a missing layer", () => {
    const frames = snapshot().frames.map((f) => structuredClone(f));
    frames.find((f) => f.name === "plan")!.elements["plan.title"]!.texts = ["Pick a plan"];
    delete frames.find((f) => f.name === "confirm")!.elements["confirm.done"];
    const failed = checkBaseline({ manifest: baseline(), frames }).checks.filter((c) => !c.passed);
    expect(failed.map((c) => [c.elementId, c.field])).toEqual([
      ["plan.title", "label"],
      ["confirm.done", "layer"],
    ]);
  });

  it("reports a hidden element drawn visible", () => {
    const frames = snapshot().frames.map((f) => structuredClone(f));
    frames.find((f) => f.name === "plan")!.elements["plan.free.note"]!.visible = true;
    const failed = checkBaseline({ manifest: baseline(), frames }).checks.filter((c) => !c.passed);
    expect(failed).toEqual([expect.objectContaining({ elementId: "plan.free.note", field: "visible", expected: "false", actual: "true" })]);
  });
});

describe("normalizeLabel", () => {
  it("collapses whitespace and drops a leading back arrow", () => {
    expect(normalizeLabel("←Back")).toBe("Back");
    expect(normalizeLabel("  Continue \n with  Free ")).toBe("Continue with Free");
  });
});
