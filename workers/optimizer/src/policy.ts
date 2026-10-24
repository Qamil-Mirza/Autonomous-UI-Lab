import {
  RawFeedbackProposal,
  SCHEMA_VERSION,
  newId,
  type DesignFeedbackPacket,
  type DesignManifest,
  type ExperimentId,
  type ExperimentProtocol,
  type Hypothesis,
  type MutationPatch,
  type ObservationTrend,
  type ReviewPolicy,
  type RiskClass,
  type TraceRef,
  type VersionId,
} from "@ghostloop/contracts";
import { isSuppressed } from "./observations";

export interface Classification {
  risk: RiskClass;
  blockReason?: string;
}

/**
 * Code-assigned risk (spec 5.4), rules applied in this exact order:
 * unknown element → protected (flag, protectedElements, or category) → unsupported op → style token allowlist → review_required.
 * Never consults `modelRisk`.
 */
export function classifyPatch(
  p: Pick<MutationPatch, "targetElementId" | "op" | "value">,
  protocol: ExperimentProtocol,
  manifest: DesignManifest,
): Classification {
  const el = manifest.elements.find((e) => e.elementId === p.targetElementId);
  if (!el) return { risk: "unknown" };

  const cats = el.categories.filter((c) => protocol.protectedCategories.includes(c));
  if (el.protected || protocol.protectedElements.includes(el.elementId) || cats.length > 0) {
    const why = cats.length > 0 ? ` (category ${cats.join(", ")})` : "";
    return { risk: "blocked", blockReason: `${el.elementId} is protected${why}` };
  }

  if (!el.supportedOps.includes(p.op)) {
    return { risk: "blocked", blockReason: `${p.op} is not a supported op for ${el.elementId}` };
  }

  if (p.op === "set_style_token" && typeof p.value === "string" && protocol.approvedStyleTokens.includes(p.value)) {
    return { risk: "low" };
  }
  return { risk: "review_required" };
}

export interface ValidatePacketContext {
  experimentId: ExperimentId;
  round: number;
  incumbentVersionId: VersionId;
  protocol: ExperimentProtocol;
  /** The incumbent version's manifest. */
  manifest: DesignManifest;
  /** This round's observations. */
  observations: ObservationTrend[];
  clock: () => string;
}

export type ValidatePacketResult =
  | { ok: true; packet: DesignFeedbackPacket; patches: MutationPatch[]; hypotheses: Hypothesis[] }
  | { ok: false; errors: string[] };

/** Model-facing constraint text: intent constraints plus one line per protected category. */
export function protectedConstraintsFor(protocol: ExperimentProtocol): string[] {
  return [
    ...protocol.intentConstraints,
    ...protocol.protectedCategories.map((c) => `Elements in the protected category "${c}" must not change.`),
  ];
}

const reviewPolicyFor = (mode: ExperimentProtocol["mode"]): ReviewPolicy => (mode === "manual" ? "manual_required" : "auto_low_risk");

/**
 * Turn untrusted model output into a packet. Any unsupported reference rejects the whole packet.
 * Code assigns IDs, sourceVersionId, risk and state; the model cannot.
 */
export function validatePacket(raw: unknown, ctx: ValidatePacketContext): ValidatePacketResult {
  const parsed = RawFeedbackProposal.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
  }
  const proposal = parsed.data;
  const { protocol, manifest } = ctx;
  const errors: string[] = [];

  if (manifest.versionId !== ctx.incumbentVersionId) {
    errors.push(`manifest is for ${manifest.versionId}, not the incumbent ${ctx.incumbentVersionId}`);
  }

  const obsById = new Map<string, ObservationTrend>(ctx.observations.map((o) => [o.id, o]));
  const elementIds = new Set(manifest.elements.map((e) => e.elementId));
  const checkObs = (where: string, ids: string[]): void => {
    for (const id of ids) if (!obsById.has(id)) errors.push(`${where} cites unknown observation ${id}`);
  };

  proposal.patches.forEach((p, i) => {
    if (p.observationIds.length === 0) errors.push(`patches[${i}] cites no observations`);
    checkObs(`patches[${i}]`, p.observationIds);
    if (!elementIds.has(p.targetElementId)) errors.push(`patches[${i}] targets unknown element ${p.targetElementId}`);
  });
  proposal.hypotheses.forEach((h, i) => checkObs(`hypotheses[${i}]`, h.observationIds));

  if (errors.length > 0) return { ok: false, errors };

  const kept = proposal.patches.filter((p) => !p.observationIds.every((id) => isSuppressed(obsById.get(id)!)));

  const patches: MutationPatch[] = kept.map((p) => {
    const { risk, blockReason } = classifyPatch(p, protocol, manifest);
    const patch = {
      schemaVersion: SCHEMA_VERSION,
      id: newId("pat"),
      experimentId: ctx.experimentId,
      round: ctx.round,
      sourceVersionId: ctx.incumbentVersionId,
      targetElementId: p.targetElementId,
      op: p.op,
      value: p.value,
      observationIds: [...p.observationIds],
      rationale: p.rationale,
      risk,
      state: risk === "blocked" ? "blocked" : "proposed",
    } as MutationPatch;
    if (p.modelRisk !== undefined) patch.modelRisk = p.modelRisk;
    if (blockReason !== undefined) patch.blockReason = blockReason;
    return patch;
  });

  const hypotheses: Hypothesis[] = proposal.hypotheses.map((h) => {
    const hyp: Hypothesis = {
      schemaVersion: SCHEMA_VERSION,
      id: newId("hyp"),
      experimentId: ctx.experimentId,
      round: ctx.round,
      observationIds: [...h.observationIds],
      statement: h.statement,
      label: "hypothesis",
    };
    if (h.confidence !== undefined) hyp.confidence = h.confidence;
    return hyp;
  });

  const cited = new Set([...patches, ...hypotheses].flatMap((x) => x.observationIds));
  const citedObs = ctx.observations.filter((o) => cited.has(o.id));
  const seenRefs = new Set<string>();
  const traceEvidence: TraceRef[] = [];
  for (const t of citedObs.flatMap((o) => o.traceRefs)) {
    const key = `${t.runId}\u0000${t.seq ?? ""}`;
    if (seenRefs.has(key)) continue;
    seenRefs.add(key);
    traceEvidence.push({ ...t });
  }

  const packet: DesignFeedbackPacket = {
    schemaVersion: SCHEMA_VERSION,
    id: newId("pkt"),
    experimentId: ctx.experimentId,
    versionId: ctx.incumbentVersionId,
    task: protocol.task,
    intentConstraints: [...protocol.intentConstraints],
    observations: citedObs.map((o) => ({ id: o.id, statement: o.statement })),
    traceEvidence,
    hypotheses,
    patches,
    protectedConstraints: protectedConstraintsFor(protocol),
    reviewPolicy: reviewPolicyFor(protocol.mode),
    createdAt: ctx.clock(),
  };

  return { ok: true, packet, patches, hypotheses };
}
