import { z } from "zod";
import { SchemaVersion } from "./version";
import { BatchId, ExperimentId, ProtocolId, VersionId } from "./ids";
import { Scenario } from "./protocol";
import { AgentActionEvent, AgentRunResult } from "./agent";

export const UsageReport = z.object({
  inferenceCalls: z.number().int().nonnegative(),
  inferenceUsd: z.number().nonnegative(),
  wallClockMs: z.number().nonnegative(),
});
export type UsageReport = z.infer<typeof UsageReport>;

export const BatchRequest = z.object({
  batchId: BatchId,
  experimentId: ExperimentId,
  protocolId: ProtocolId,
  versionId: VersionId,
  versionUrl: z.string().min(1),
  task: z.string().min(1),
  scenarios: z.array(Scenario).min(1),
  runsPerBatch: z.number().int().positive(),
  maxActionsPerRun: z.number().int().positive(),
  maxConcurrency: z.number().int().positive(),
  hiddenGoalRef: z.string().min(1),
});
export type BatchRequest = z.infer<typeof BatchRequest>;

export const BatchResult = z.object({
  schemaVersion: SchemaVersion,
  batchId: BatchId,
  versionId: VersionId,
  runs: z.array(AgentRunResult),
  usage: UsageReport,
  cancelled: z.boolean(),
  plannedRuns: z.number().int().positive(),
});
export type BatchResult = z.infer<typeof BatchResult>;

export interface SimulationAdapter {
  runBatch(req: BatchRequest, onEvent: (e: AgentActionEvent) => void, signal: AbortSignal): Promise<BatchResult>;
}
