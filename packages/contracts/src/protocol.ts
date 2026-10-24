import { z } from "zod";
import { SchemaVersion } from "./version";
import { ExperimentId, ProtocolId, ScenarioId, VersionId } from "./ids";
import { ProtectedCategory, ReviewMode } from "./enums";

export const Scenario = z.object({
  id: ScenarioId,
  name: z.string().min(1),
  description: z.string(),
  inputs: z.record(z.string(), z.string()),
  runs: z.number().int().positive(),
});
export type Scenario = z.infer<typeof Scenario>;

export const EvaluationPolicy = z.object({
  targetCompletionRate: z.number().min(0).max(1),
  minImprovementPp: z.number().nonnegative().default(10),
  maxMedianActionsIncrease: z.number().nonnegative().default(2),
  maxValidationErrorRateIncreasePp: z.number().nonnegative().default(15),
  minValidFraction: z.number().min(0).max(1).default(0.75),
  minValidPerScenario: z.number().int().nonnegative().default(1),
});
export type EvaluationPolicy = z.infer<typeof EvaluationPolicy>;

export const Budgets = z.object({
  maxActionsPerRun: z.number().int().positive(),
  runsPerBatch: z.number().int().positive(),
  maxConcurrency: z.number().int().positive(),
  maxIterations: z.number().int().positive(),
  maxCandidates: z.number().int().positive(),
  maxInferenceUsd: z.number().nonnegative(),
  maxWallClockMs: z.number().int().positive(),
});
export type Budgets = z.infer<typeof Budgets>;

export const ExperimentProtocol = z.object({
  schemaVersion: SchemaVersion,
  id: ProtocolId,
  experimentId: ExperimentId,
  baseVersionId: VersionId,
  task: z.string().min(1),
  hiddenGoalRef: z.string().min(1),
  allowedPaths: z.array(z.string()),
  intentConstraints: z.array(z.string()),
  protectedElements: z.array(z.string()),
  protectedCategories: z.array(ProtectedCategory),
  approvedStyleTokens: z.array(z.string()),
  mode: ReviewMode,
  scenarios: z.array(Scenario).min(1),
  budgets: Budgets,
  policy: EvaluationPolicy,
  frozenAt: z.string().datetime(),
});
export type ExperimentProtocol = z.infer<typeof ExperimentProtocol>;

export const ExperimentProtocolDraft = ExperimentProtocol.omit({ id: true, frozenAt: true, experimentId: true });
export type ExperimentProtocolDraft = z.infer<typeof ExperimentProtocolDraft>;
