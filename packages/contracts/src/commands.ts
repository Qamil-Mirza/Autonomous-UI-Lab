import { z } from "zod";
import { CandidateId, ExperimentId, ObservationId, PatchId, VersionId } from "./ids";
import { CandidateReviewStatus, ObservationDisposition } from "./enums";
import { ExperimentProtocolDraft } from "./protocol";

export const CreateExperiment = z.object({
  protocol: ExperimentProtocolDraft,
  baseVersionUrl: z.string().url(),
  baseManifestHash: z.string().min(1),
});
export type CreateExperiment = z.infer<typeof CreateExperiment>;

export const StartExperiment = z.object({ experimentId: ExperimentId });
export type StartExperiment = z.infer<typeof StartExperiment>;

export const CancelExperiment = z.object({ experimentId: ExperimentId, reason: z.string().optional() });
export type CancelExperiment = z.infer<typeof CancelExperiment>;

export const SetObservationDisposition = z.object({
  experimentId: ExperimentId,
  observationId: ObservationId,
  disposition: ObservationDisposition,
});
export type SetObservationDisposition = z.infer<typeof SetObservationDisposition>;

export const ApprovePatches = z.object({
  experimentId: ExperimentId,
  sourceVersionId: VersionId,
  round: z.number().int().nonnegative(),
  patchIds: z.array(PatchId),
  approvedBy: z.string().min(1),
});
export type ApprovePatches = z.infer<typeof ApprovePatches>;

export const RecordFinalReview = z.object({
  experimentId: ExperimentId,
  candidateId: CandidateId,
  status: CandidateReviewStatus.exclude(["pending"]),
  note: z.string().optional(),
});
export type RecordFinalReview = z.infer<typeof RecordFinalReview>;

/** The `kind` a designer command is submitted under; each names the payload schema above. */
export const CommandKind = z.enum([
  "createExperiment", "startExperiment", "cancelExperiment", "setObservationDisposition", "approvePatches", "recordFinalReview",
]);
export type CommandKind = z.infer<typeof CommandKind>;

export const CommandErrorCode = z.enum([
  "NOT_FOUND", "INVALID_STATE", "STALE_SOURCE_VERSION", "ALREADY_APPROVED", "UNKNOWN_PATCH", "PATCH_BLOCKED", "VALIDATION_FAILED",
  "INTERNAL",
]);
export type CommandErrorCode = z.infer<typeof CommandErrorCode>;

export type CommandResult<T> = { ok: true; value: T } | { ok: false; code: CommandErrorCode; message: string };
