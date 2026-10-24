import { z } from "zod";
import { SchemaVersion } from "./version";
import { BatchId, ExperimentId, HypothesisId, ObservationId, PatchId, RunId, VersionId } from "./ids";
import { MutationOp, ObservationDisposition, PatchState, RiskClass } from "./enums";
import { ManifestElement } from "./manifest";
import { UsageReport } from "./simulation";
import { FigmaReference } from "./candidate";

export const TraceRef = z.object({ runId: RunId, seq: z.number().int().nonnegative().optional() });
export type TraceRef = z.infer<typeof TraceRef>;

export const ObservationKind = z.enum(["outcome_count", "screen_revisit", "repeated_failed_action", "validation_error", "step_limit"]);
export type ObservationKind = z.infer<typeof ObservationKind>;

export const ObservationTrend = z.object({
  schemaVersion: SchemaVersion,
  id: ObservationId,
  experimentId: ExperimentId,
  versionId: VersionId,
  batchId: BatchId,
  kind: ObservationKind,
  statement: z.string().min(1),
  numerator: z.number().int().nonnegative(),
  denominator: z.number().int().nonnegative(),
  traceRefs: z.array(TraceRef),
  screens: z.array(z.string()),
  elementIds: z.array(z.string()),
  interpretation: z.string().optional(),
  disposition: ObservationDisposition,
  fingerprint: z.string().min(1),
});
export type ObservationTrend = z.infer<typeof ObservationTrend>;

export const Confidence = z.enum(["low", "medium", "high"]);
export type Confidence = z.infer<typeof Confidence>;

export const Hypothesis = z.object({
  schemaVersion: SchemaVersion,
  id: HypothesisId,
  observationIds: z.array(ObservationId),
  statement: z.string().min(1),
  label: z.literal("hypothesis"),
  confidence: Confidence.optional(),
});
export type Hypothesis = z.infer<typeof Hypothesis>;

const orderValue = z.number().int().nonnegative();
export const PatchValue = z.union([z.string(), orderValue, z.boolean()]);
export type PatchValue = z.infer<typeof PatchValue>;

const patchBase = {
  schemaVersion: SchemaVersion,
  id: PatchId,
  experimentId: ExperimentId,
  round: z.number().int().nonnegative(),
  sourceVersionId: VersionId,
  targetElementId: z.string().min(1),
  observationIds: z.array(ObservationId),
  rationale: z.string().min(1),
  modelRisk: RiskClass.optional(),
  risk: RiskClass,
  state: PatchState,
  blockReason: z.string().optional(),
};

export const MutationPatch = z.discriminatedUnion("op", [
  z.object({ ...patchBase, op: z.literal("set_label"), value: z.string() }),
  z.object({ ...patchBase, op: z.literal("set_style_token"), value: z.string() }),
  z.object({ ...patchBase, op: z.literal("set_order"), value: orderValue }),
  z.object({ ...patchBase, op: z.literal("set_visibility"), value: z.boolean() }),
]);
export type MutationPatch = z.infer<typeof MutationPatch>;

const rawBase = {
  targetElementId: z.string().min(1),
  observationIds: z.array(ObservationId),
  rationale: z.string().min(1),
  modelRisk: RiskClass.optional(),
};
export const RawPatchProposal = z.discriminatedUnion("op", [
  z.object({ ...rawBase, op: z.literal("set_label"), value: z.string() }).strict(),
  z.object({ ...rawBase, op: z.literal("set_style_token"), value: z.string() }).strict(),
  z.object({ ...rawBase, op: z.literal("set_order"), value: orderValue }).strict(),
  z.object({ ...rawBase, op: z.literal("set_visibility"), value: z.boolean() }).strict(),
]);
export type RawPatchProposal = z.infer<typeof RawPatchProposal>;

export const RawHypothesisProposal = z
  .object({ statement: z.string().min(1), observationIds: z.array(ObservationId), confidence: Confidence.optional() })
  .strict();
export type RawHypothesisProposal = z.infer<typeof RawHypothesisProposal>;

export const RawFeedbackProposal = z.object({
  hypotheses: z.array(RawHypothesisProposal),
  patches: z.array(RawPatchProposal),
});
export type RawFeedbackProposal = z.infer<typeof RawFeedbackProposal>;

export const ReviewPolicy = z.enum(["manual_required", "auto_low_risk"]);
export type ReviewPolicy = z.infer<typeof ReviewPolicy>;

export const DesignFeedbackPacket = z.object({
  schemaVersion: SchemaVersion,
  id: z.string().min(1),
  experimentId: ExperimentId,
  versionId: VersionId,
  figmaRef: FigmaReference.optional(),
  task: z.string().min(1),
  intentConstraints: z.array(z.string()),
  observations: z.array(z.object({ id: ObservationId, statement: z.string() })),
  traceEvidence: z.array(TraceRef),
  hypotheses: z.array(Hypothesis),
  patches: z.array(MutationPatch),
  protectedConstraints: z.array(z.string()),
  reviewPolicy: ReviewPolicy,
  createdAt: z.string().datetime(),
});
export type DesignFeedbackPacket = z.infer<typeof DesignFeedbackPacket>;

export interface AnalysisInput {
  experimentId: ExperimentId;
  versionId: VersionId;
  task: string;
  intentConstraints: string[];
  protectedConstraints: string[];
  observations: ObservationTrend[];
  editableElements: ManifestElement[];
}

export interface AnalysisAdapter {
  proposeFeedback(input: AnalysisInput): Promise<{ raw: unknown; usage: UsageReport }>;
}
