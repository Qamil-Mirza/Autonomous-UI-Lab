import { z } from "zod";
import { SchemaVersion } from "./version";
import { ApprovalId, BatchId, CandidateId, EvaluationId, ExperimentId, ObservationId, PatchId, VersionId } from "./ids";
import { ExperimentState, StoppingReason } from "./enums";
import { ExperimentProtocol } from "./protocol";
import { UsageReport } from "./simulation";
import { JudgeInfo } from "./judge";

const ts = z.string().datetime();

export const StateTransition = z.object({ from: ExperimentState, to: ExperimentState, at: ts, note: z.string().optional() });
export type StateTransition = z.infer<typeof StateTransition>;

export const RoundState = z.object({
  index: z.number().int().nonnegative(),
  baselineBatchId: BatchId.optional(),
  packetId: z.string().min(1).optional(),
  approvalId: ApprovalId.optional(),
  candidateId: CandidateId.optional(),
  candidateBatchId: BatchId.optional(),
  evaluationId: EvaluationId.optional(),
  analysisAttempts: z.number().int().nonnegative(),
});
export type RoundState = z.infer<typeof RoundState>;

export const StoppingRecord = z.object({
  reason: StoppingReason,
  at: ts,
  bestVersionId: VersionId,
  attemptedCandidateIds: z.array(CandidateId),
  evaluationIds: z.array(EvaluationId),
  rejectedPatchIds: z.array(PatchId),
  remainingObservationIds: z.array(ObservationId),
});
export type StoppingRecord = z.infer<typeof StoppingRecord>;

export const BatchRecord = z.object({
  batchId: BatchId,
  experimentId: ExperimentId,
  versionId: VersionId,
  phase: z.enum(["baseline", "candidate"]),
  round: z.number().int().nonnegative(),
  plannedRuns: z.number().int().nonnegative(),
  cancelled: z.boolean(),
  usage: UsageReport,
  superseded: z.boolean(),
  judge: JudgeInfo.optional(),
});
export type BatchRecord = z.infer<typeof BatchRecord>;

export const Experiment = z.object({
  schemaVersion: SchemaVersion,
  id: ExperimentId,
  protocol: ExperimentProtocol,
  state: ExperimentState,
  incumbentVersionId: VersionId,
  round: RoundState,
  transitions: z.array(StateTransition),
  usage: UsageReport,
  startedAt: ts.optional(),
  cancelRequested: z.boolean(),
  stopping: StoppingRecord.optional(),
});
export type Experiment = z.infer<typeof Experiment>;

export const Approval = z.object({
  schemaVersion: SchemaVersion,
  id: ApprovalId,
  experimentId: ExperimentId,
  round: z.number().int().nonnegative(),
  sourceVersionId: VersionId,
  patchIds: z.array(PatchId),
  approvedBy: z.string().min(1),
  at: ts,
});
export type Approval = z.infer<typeof Approval>;
