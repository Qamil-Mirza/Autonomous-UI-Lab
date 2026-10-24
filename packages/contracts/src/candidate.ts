import { z } from "zod";
import { SchemaVersion } from "./version";
import { CandidateId, PatchId, ValidationId, VersionId } from "./ids";
import { CandidateReviewStatus, CheckKind, FigmaStatus } from "./enums";
import type { DesignManifest } from "./manifest";
import type { MutationPatch } from "./analysis";
import { EvaluationId } from "./ids";

export const FigmaReference = z.object({
  frameUrl: z.string().min(1),
  status: FigmaStatus,
  manifestHash: z.string().min(1),
  patchIds: z.array(PatchId),
});
export type FigmaReference = z.infer<typeof FigmaReference>;

export const DesignVersion = z.object({
  schemaVersion: SchemaVersion,
  id: VersionId,
  parentVersionId: VersionId.nullable(),
  patchIds: z.array(PatchId),
  url: z.string().url(),
  manifestHash: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type DesignVersion = z.infer<typeof DesignVersion>;

export const CandidateDesign = z.object({
  schemaVersion: SchemaVersion,
  id: CandidateId,
  versionId: VersionId,
  parentVersionId: VersionId,
  patchIds: z.array(PatchId),
  url: z.string().url(),
  figma: FigmaReference.optional(),
  reviewStatus: CandidateReviewStatus,
  evaluationId: EvaluationId.optional(),
  createdAt: z.string().datetime(),
});
export type CandidateDesign = z.infer<typeof CandidateDesign>;

export const ValidationCheck = z.object({
  name: z.string().min(1),
  kind: CheckKind,
  passed: z.boolean(),
  detail: z.string().optional(),
});
export type ValidationCheck = z.infer<typeof ValidationCheck>;

export const ValidationResult = z.object({
  schemaVersion: SchemaVersion,
  id: ValidationId.optional(),
  candidateId: CandidateId,
  ok: z.boolean(),
  checks: z.array(ValidationCheck),
  at: z.string().datetime(),
});
export type ValidationResult = z.infer<typeof ValidationResult>;

export interface CandidateAdapter {
  createCandidate(sourceVersionId: VersionId, approvedPatches: MutationPatch[]): Promise<CandidateDesign>;
  validateCandidate(candidateId: CandidateId): Promise<ValidationResult>;
  getManifest(versionId: VersionId): Promise<DesignManifest>;
}
