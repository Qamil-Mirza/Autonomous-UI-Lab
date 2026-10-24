import { z } from "zod";

export const idSchema = <P extends string>(prefix: P) =>
  z.string().refine((s): s is `${P}_${string}` => s.startsWith(`${prefix}_`) && s.length > prefix.length + 1, {
    message: `id must start with "${prefix}_"`,
  });

export const ExperimentId = idSchema("exp");
export const VersionId = idSchema("ver");
export const ScenarioId = idSchema("scn");
export const RunId = idSchema("run");
export const ObservationId = idSchema("obs");
export const HypothesisId = idSchema("hyp");
export const PatchId = idSchema("pat");
export const CandidateId = idSchema("cand");
export const ValidationId = idSchema("val");
export const EvaluationId = idSchema("eval");
export const ApprovalId = idSchema("appr");
export const BatchId = idSchema("batch");
export const ProtocolId = idSchema("proto");

export type ExperimentId = z.infer<typeof ExperimentId>;
export type VersionId = z.infer<typeof VersionId>;
export type ScenarioId = z.infer<typeof ScenarioId>;
export type RunId = z.infer<typeof RunId>;
export type ObservationId = z.infer<typeof ObservationId>;
export type HypothesisId = z.infer<typeof HypothesisId>;
export type PatchId = z.infer<typeof PatchId>;
export type CandidateId = z.infer<typeof CandidateId>;
export type ValidationId = z.infer<typeof ValidationId>;
export type EvaluationId = z.infer<typeof EvaluationId>;
export type ApprovalId = z.infer<typeof ApprovalId>;
export type BatchId = z.infer<typeof BatchId>;
export type ProtocolId = z.infer<typeof ProtocolId>;

export function newId<P extends string>(prefix: P): `${P}_${string}` {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}
