import { z } from "zod";
import { SchemaVersion } from "./version";
import { BatchId, EvaluationId, ExperimentId, ProtocolId, ScenarioId, VersionId } from "./ids";
import { EvaluationDecision, RunOutcome, StoppingReason } from "./enums";

export const OutcomeCounts = z.object(
  Object.fromEntries(RunOutcome.options.map((o) => [o, z.number().int().nonnegative()])) as Record<RunOutcome, z.ZodNumber>,
);
export type OutcomeCounts = z.infer<typeof OutcomeCounts>;

const rate = z.number().min(0).max(1).nullable();

export const ScenarioMetrics = z.object({
  scenarioId: ScenarioId,
  plannedRuns: z.number().int().nonnegative(),
  validRuns: z.number().int().nonnegative(),
  successes: z.number().int().nonnegative(),
  completionRate: rate,
  outcomeCounts: OutcomeCounts,
  medianActionsToSuccess: z.number().nonnegative().nullable(),
  complete: z.boolean(),
});
export type ScenarioMetrics = z.infer<typeof ScenarioMetrics>;

export const RunMetrics = z.object({
  versionId: VersionId,
  batchId: BatchId,
  plannedRuns: z.number().int().nonnegative(),
  validRuns: z.number().int().nonnegative(),
  successes: z.number().int().nonnegative(),
  completionRate: rate,
  outcomeCounts: OutcomeCounts,
  infraErrors: z.number().int().nonnegative(),
  cancelled: z.boolean(),
  medianActionsToSuccess: z.number().nonnegative().nullable(),
  backtrackRuns: z.number().int().nonnegative(),
  validationErrorRuns: z.number().int().nonnegative(),
  perScenario: z.array(ScenarioMetrics),
  complete: z.boolean(),
  incompleteReason: z.string().optional(),
});
export type RunMetrics = z.infer<typeof RunMetrics>;

export const GuardrailResult = z.object({
  name: z.string().min(1),
  passed: z.boolean(),
  detail: z.string().optional(),
});
export type GuardrailResult = z.infer<typeof GuardrailResult>;

export const Evaluation = z.object({
  schemaVersion: SchemaVersion,
  id: EvaluationId,
  experimentId: ExperimentId,
  protocolId: ProtocolId,
  baselineVersionId: VersionId,
  candidateVersionId: VersionId,
  baseline: RunMetrics,
  candidate: RunMetrics.nullable(),
  guardrails: z.array(GuardrailResult),
  deltaPp: z.number().nullable(),
  decision: EvaluationDecision,
  reasons: z.array(z.string()),
  stoppingReason: StoppingReason.optional(),
  at: z.string().datetime(),
});
export type Evaluation = z.infer<typeof Evaluation>;
