import { z } from "zod";
import { SchemaVersion } from "./version";
import { BatchId, ExperimentId, ProtocolId, RunId, ScenarioId, VersionId } from "./ids";
import { ActionResult, ActionType, BEHAVIORAL_OUTCOMES, RunOutcome } from "./enums";
import { Scenario } from "./protocol";
import { JudgeRecord } from "./judge";

export const ScreenshotRef = z.object({
  uri: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type ScreenshotRef = z.infer<typeof ScreenshotRef>;

export const Point = z.object({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof Point>;

export const Viewport = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type Viewport = z.infer<typeof Viewport>;

export const Control = z.object({
  elementId: z.string().min(1),
  role: z.string().min(1),
  label: z.string(),
  enabled: z.boolean(),
});
export type Control = z.infer<typeof Control>;

export const AgentAction = z.object({
  type: ActionType,
  elementId: z.string().min(1).optional(),
  value: z.string().optional(),
  reason: z.string().optional(),
});
export type AgentAction = z.infer<typeof AgentAction>;

export const PublicAgentInput = z
  .object({
    runId: RunId,
    task: z.string().min(1),
    scenario: Scenario.pick({ description: true, inputs: true }),
    screenshot: ScreenshotRef,
    controls: z.array(Control),
    previousActions: z.array(AgentAction),
    // Optional additions preserve existing consumers and fixtures.
    visibleUI: z.object({ screenId: z.string(), alerts: z.array(z.string()) }).strict().optional(),
    history: z.array(z.object({
      seq: z.number().int().nonnegative(), action: AgentAction,
      screenBefore: z.string(), screenAfter: z.string(), result: ActionResult,
      alerts: z.array(z.string()),
    }).strict()).optional(),
    remainingActions: z.number().int().nonnegative(),
  })
  .strict();
export type PublicAgentInput = z.infer<typeof PublicAgentInput>;

export const AgentActionEvent = z.object({
  decisionSource: z.enum(['model', 'scenario']).optional(),
  experimentId: ExperimentId.optional(),
  protocolId: ProtocolId.optional(),
  scenarioId: ScenarioId.optional(),
  batchId: BatchId.optional(),
  screenshotBefore: ScreenshotRef.optional(),
  validationFeedback: z.array(z.string()).optional(),
  executionStatus: z.enum(['executed', 'rejected', 'unknown']).optional(),
  error: z.string().optional(),
  runId: RunId,
  seq: z.number().int().nonnegative(),
  at: z.string().datetime(),
  versionId: VersionId,
  screenBefore: z.string().min(1),
  screenAfter: z.string().min(1),
  action: AgentAction,
  result: ActionResult,
  pointer: Point.optional(),
  viewport: Viewport,
  screenshot: ScreenshotRef.optional(),
});
export type AgentActionEvent = z.infer<typeof AgentActionEvent>;

export function isBehaviorallyValid(outcome: RunOutcome): boolean {
  return (BEHAVIORAL_OUTCOMES as readonly string[]).includes(outcome);
}

export const AgentRunResultObject = z.object({
  schemaVersion: SchemaVersion,
  runId: RunId,
  experimentId: ExperimentId,
  protocolId: ProtocolId,
  versionId: VersionId,
  scenarioId: ScenarioId,
  batchId: BatchId,
  events: z.array(AgentActionEvent),
  goalVerified: z.boolean(),
  goalEvidence: z.string().optional(),
  stepCount: z.number().int().nonnegative(),
  outcome: RunOutcome,
  terminalScreen: z.string().min(1),
  lastPointer: Point.optional(),
  screenshots: z.array(ScreenshotRef),
  behaviorallyValid: z.boolean(),
  /** Set when a judge scored the trial against the task as written. */
  judge: JudgeRecord.optional(),
  /** The protected rule the trial broke, which always fails it. */
  protectedViolation: z.string().min(1).optional(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
});

export const AgentRunResult = AgentRunResultObject.superRefine((r, ctx) => {
  if ((r.outcome === "goal") !== r.goalVerified) {
    ctx.addIssue({ code: "custom", path: ["goalVerified"], message: 'outcome "goal" requires goalVerified === true, and vice versa' });
  }
  if (r.behaviorallyValid !== isBehaviorallyValid(r.outcome)) {
    ctx.addIssue({ code: "custom", path: ["behaviorallyValid"], message: "behaviorallyValid must match outcome" });
  }
  const seen = new Set<number>();
  r.events.forEach((e, i) => {
    if (e.runId !== r.runId) {
      ctx.addIssue({ code: "custom", path: ["events", i, "runId"], message: "event runId must equal run runId" });
    }
    if (seen.has(e.seq)) {
      ctx.addIssue({ code: "custom", path: ["events", i, "seq"], message: "duplicate event seq" });
    }
    seen.add(e.seq);
  });
});
export type AgentRunResult = z.infer<typeof AgentRunResult>;
