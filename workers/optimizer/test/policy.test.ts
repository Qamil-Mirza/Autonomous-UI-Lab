import { describe, expect, it } from "vitest";
import {
  BatchResult,
  DesignFeedbackPacket,
  DesignManifest,
  ExperimentProtocol,
  Hypothesis,
  MutationPatch,
  type ObservationDisposition,
} from "@ghostloop/contracts";
import { loadFixture } from "@ghostloop/contracts/fixtures";
import { aggregateObservations } from "../src/observations";
import { classifyPatch, validatePacket } from "../src/policy";

const protocol = loadFixture("protocol.default.json", ExperimentProtocol);
const manifest = loadFixture("manifest.legacy.json", DesignManifest);
const batch = loadFixture("batch.baseline.json", BatchResult);

function observationsWith(dispositions: Map<string, ObservationDisposition>) {
  return aggregateObservations({
    experimentId: protocol.experimentId,
    versionId: batch.versionId,
    batchId: batch.batchId,
    runs: batch.runs,
    dispositions,
  });
}

const observations = observationsWith(new Map());
const planObs = observations.find((o) => o.fingerprint === "screen_revisit|plan")!;
const stepObs = observations.find((o) => o.kind === "step_limit")!;

const ctx = {
  experimentId: protocol.experimentId,
  round: 1,
  incumbentVersionId: manifest.versionId,
  protocol,
  manifest,
  observations,
  clock: () => "2026-10-23T09:30:00.000Z",
};

const rawLabelPatch = {
  op: "set_label" as const,
  targetElementId: "plan.free.cta",
  value: "Start free",
  observationIds: [planObs.id],
  rationale: "Runs returned to plan; a label that states the outcome may help.",
};
const rawStylePatch = {
  op: "set_style_token" as const,
  targetElementId: "plan.free.cta",
  value: "button.primary",
  observationIds: [stepObs.id],
  rationale: "Primary emphasis on the free plan action.",
};
const rawPricePatch = {
  op: "set_label" as const,
  targetElementId: "plan.pro.price",
  value: "Free forever",
  observationIds: [planObs.id],
  rationale: "Clarify pricing.",
  modelRisk: "low" as const,
};
const rawHypothesis = { statement: "Agents use the comparison view before choosing.", observationIds: [planObs.id], confidence: "medium" as const };

describe("classifyPatch", () => {
  it("supports the current baseline's noninteractive Free note visibility patch", () => {
    const current = loadFixture("manifest.base.json", DesignManifest);
    expect(classifyPatch({ targetElementId: "plan.free.note", op: "set_visibility", value: true }, protocol, current).risk).toBe("review_required");
  });
  it.each([
    ["plan.pro.price", "set_label", "x", "blocked"],
    ["signup.consent", "set_visibility", false, "blocked"],
    ["invite.email", "set_label", "x", "blocked"],
    ["plan.free.cta", "set_order", 0, "blocked"], // op not in supportedOps
    ["nope.element", "set_label", "x", "unknown"],
    ["plan.free.cta", "set_style_token", "button.primary", "low"],
    ["plan.free.cta", "set_style_token", "neon.glow", "review_required"],
    ["plan.free.cta", "set_label", "Continue with Free plan", "review_required"],
    ["plan.compare.link", "set_visibility", false, "review_required"],
  ])("%s %s → %s", (el, op, value, risk) => {
    expect(classifyPatch({ targetElementId: el, op, value } as any, protocol, manifest).risk).toBe(risk);
  });

  it("blocked results carry a reason; others do not", () => {
    expect(classifyPatch({ targetElementId: "plan.pro.price", op: "set_label", value: "x" }, protocol, manifest).blockReason).toMatch(
      /plan\.pro\.price.*protected.*pricing/,
    );
    expect(classifyPatch({ targetElementId: "plan.free.cta", op: "set_order", value: 0 }, protocol, manifest).blockReason).toMatch(
      /set_order/,
    );
    expect(classifyPatch({ targetElementId: "plan.free.cta", op: "set_label", value: "x" }, protocol, manifest).blockReason).toBeUndefined();
  });

  it("blocks each protection source independently", () => {
    const open = { elementId: "x.el", screen: "x", role: "button", protected: false, categories: [], supportedOps: ["set_label" as const] };
    const m = (el: object) => ({ ...manifest, elements: [{ ...open, ...el }] });
    const p = { targetElementId: "x.el", op: "set_label" as const, value: "y" };
    expect(classifyPatch(p, protocol, m({})).risk).toBe("review_required");
    expect(classifyPatch(p, protocol, m({ protected: true })).risk).toBe("blocked");
    expect(classifyPatch(p, protocol, m({ categories: ["checker"] })).risk).toBe("blocked");
    expect(classifyPatch(p, { ...protocol, protectedElements: ["x.el"] }, m({})).risk).toBe("blocked");
    // category only protected if the protocol lists it
    expect(classifyPatch(p, { ...protocol, protectedCategories: [] }, m({ categories: ["checker"] })).risk).toBe("review_required");
  });

  it("duplicate elementIds (schema bypassed): any protected match blocks, otherwise unknown", () => {
    const open = { elementId: "x.el", screen: "x", role: "button", protected: false, categories: [], supportedOps: ["set_label" as const] };
    // Built in-test without DesignManifest.parse, which now rejects duplicates.
    const dup = (...els: object[]) => ({ ...manifest, elements: els.map((el) => ({ ...open, ...el })) }) as DesignManifest;
    const p = { targetElementId: "x.el", op: "set_label" as const, value: "y" };
    expect(DesignManifest.safeParse(dup({}, {})).success).toBe(false);
    expect(classifyPatch(p, protocol, dup({}, {})).risk).toBe("unknown");
    const prot = classifyPatch(p, protocol, dup({}, { protected: true }));
    expect(prot.risk).toBe("blocked");
    expect(prot.blockReason).toMatch(/x\.el is protected/);
    expect(classifyPatch(p, protocol, dup({}, { categories: ["checker"] })).risk).toBe("blocked");
  });
});

describe("validatePacket", () => {
  it("model risk never lowers code risk", () => {
    const r = validatePacket({ hypotheses: [], patches: [{ ...rawLabelPatch, modelRisk: "low" }] }, ctx);
    expect(r.ok && r.patches[0]!.risk).toBe("review_required");
    expect(r.ok && r.patches[0]!.modelRisk).toBe("low");
  });

  it("rejects unknown observation or element references", () => {
    const badObs = validatePacket({ hypotheses: [], patches: [{ ...rawLabelPatch, observationIds: ["obs_missing"] }] }, ctx);
    expect(badObs.ok).toBe(false);
    expect(!badObs.ok && badObs.errors.join("\n")).toMatch(/obs_missing/);
    const badEl = validatePacket({ hypotheses: [], patches: [{ ...rawLabelPatch, targetElementId: "ghost.el" }] }, ctx);
    expect(badEl.ok).toBe(false);
    expect(!badEl.ok && badEl.errors.join("\n")).toMatch(/ghost\.el/);
  });

  it("one bad reference fails the whole packet", () => {
    const r = validatePacket({ hypotheses: [], patches: [rawStylePatch, { ...rawLabelPatch, observationIds: [planObs.id, "obs_missing"] }] }, ctx);
    expect(r.ok).toBe(false);
  });

  it("rejects patches that cite no observations", () => {
    expect(validatePacket({ hypotheses: [], patches: [{ ...rawLabelPatch, observationIds: [] }] }, ctx).ok).toBe(false);
  });

  it("rejects hypotheses citing unknown observations", () => {
    const r = validatePacket({ hypotheses: [{ ...rawHypothesis, observationIds: ["obs_nope"] }], patches: [rawStylePatch] }, ctx);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.join("\n")).toMatch(/obs_nope/);
  });

  it("rejects malformed proposals and model-assigned fields", () => {
    expect(validatePacket({ patches: [] }, ctx).ok).toBe(false);
    expect(validatePacket({ hypotheses: [], patches: [{ ...rawLabelPatch, risk: "low" }] }, ctx).ok).toBe(false);
    expect(validatePacket({ hypotheses: [], patches: [{ ...rawLabelPatch, id: "pat_x" }] }, ctx).ok).toBe(false);
    expect(validatePacket({ hypotheses: [], patches: [{ ...rawLabelPatch, sourceVersionId: "ver_x" }] }, ctx).ok).toBe(false);
  });

  it("rejects a manifest that is not the incumbent's", () => {
    const r = validatePacket({ hypotheses: [], patches: [rawLabelPatch] }, { ...ctx, incumbentVersionId: "ver_other" });
    expect(r.ok).toBe(false);
  });

  it("blocked patches are kept but marked", () => {
    const r = validatePacket({ hypotheses: [], patches: [rawPricePatch] }, ctx);
    expect(r.ok && r.patches[0]!.state).toBe("blocked");
    expect(r.ok && r.patches[0]!.risk).toBe("blocked");
    expect(r.ok && r.patches[0]!.blockReason).toBeTruthy();
  });

  it("drops patches citing only suppressed findings", () => {
    const suppressed = observationsWith(new Map([["screen_revisit|plan", "not_relevant"]]));
    const planS = suppressed.find((o) => o.fingerprint === "screen_revisit|plan")!;
    const stepS = suppressed.find((o) => o.kind === "step_limit")!;
    const sctx = { ...ctx, observations: suppressed };
    const onlySuppressed = validatePacket({ hypotheses: [], patches: [{ ...rawLabelPatch, observationIds: [planS.id] }] }, sctx);
    expect(onlySuppressed.ok).toBe(true);
    expect(onlySuppressed.ok && onlySuppressed.patches).toHaveLength(0);
    expect(onlySuppressed.ok && onlySuppressed.packet.patches).toHaveLength(0);
    const mixed = validatePacket({ hypotheses: [], patches: [{ ...rawLabelPatch, observationIds: [planS.id, stepS.id] }] }, sctx);
    expect(mixed.ok && mixed.patches).toHaveLength(1);
  });

  it("assigns IDs, source version, review policy, and builds a schema-valid packet", () => {
    const r = validatePacket(
      { hypotheses: [rawHypothesis], patches: [rawLabelPatch, rawStylePatch, rawPricePatch] },
      ctx,
    );
    if (!r.ok) throw new Error(r.errors.join("; "));
    expect(r.patches.map((p) => p.risk)).toEqual(["review_required", "low", "blocked"]);
    expect(r.patches.map((p) => p.state)).toEqual(["proposed", "proposed", "blocked"]);
    for (const p of r.patches) {
      expect(MutationPatch.parse(p)).toEqual(p);
      expect(p.id.startsWith("pat_")).toBe(true);
      expect(p.sourceVersionId).toBe(manifest.versionId);
      expect(p.experimentId).toBe(protocol.experimentId);
      expect(p.round).toBe(1);
    }
    expect(new Set(r.patches.map((p) => p.id)).size).toBe(3);
    const h = r.hypotheses[0]!;
    expect(Hypothesis.parse(h)).toEqual(h);
    expect(h.label).toBe("hypothesis");
    expect(h.id.startsWith("hyp_")).toBe(true);
    expect(h.round).toBe(1);
    expect(h.experimentId).toBe(protocol.experimentId);

    const pkt = r.packet;
    expect(DesignFeedbackPacket.parse(pkt)).toEqual(pkt);
    expect(pkt.versionId).toBe(manifest.versionId);
    expect(pkt.reviewPolicy).toBe("manual_required");
    expect(pkt.createdAt).toBe("2026-10-23T09:30:00.000Z");
    expect(pkt.task).toBe(protocol.task);
    expect(pkt.intentConstraints).toEqual(protocol.intentConstraints);
    expect(pkt.patches).toEqual(r.patches);
    expect(pkt.hypotheses).toEqual(r.hypotheses);
    expect(pkt.observations).toEqual([
      { id: planObs.id, statement: planObs.statement },
      { id: stepObs.id, statement: stepObs.statement },
    ]);
    const refKey = (t: { runId: string; seq?: number }) => `${t.runId}:${t.seq}`;
    const expectedRefs = new Set([...planObs.traceRefs, ...stepObs.traceRefs].map(refKey));
    expect(new Set(pkt.traceEvidence.map(refKey))).toEqual(expectedRefs);
    expect(pkt.traceEvidence.length).toBe(expectedRefs.size);
    for (const c of protocol.intentConstraints) expect(pkt.protectedConstraints).toContain(c);
    for (const cat of protocol.protectedCategories) expect(pkt.protectedConstraints.some((l) => l.includes(cat))).toBe(true);
  });

  it("auto mode yields auto_low_risk", () => {
    const r = validatePacket({ hypotheses: [], patches: [rawStylePatch] }, { ...ctx, protocol: { ...protocol, mode: "auto" } });
    expect(r.ok && r.packet.reviewPolicy).toBe("auto_low_risk");
  });
});
