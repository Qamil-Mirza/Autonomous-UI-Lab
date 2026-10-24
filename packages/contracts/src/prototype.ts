import { z } from 'zod';
import { RunId, VersionId } from './ids';

// Public registry entries: deliberately allowlisted; mutation-policy fields are stripped.
export const ControlRegistryEntry = z.object({
  elementId: z.string().min(1), screen: z.string().min(1), role: z.string().min(1), label: z.string(),
});
export type ControlRegistryEntry = z.infer<typeof ControlRegistryEntry>;
export const ControlRegistry = z.object({ versionId: VersionId, elements: z.array(ControlRegistryEntry) });
export type ControlRegistry = z.infer<typeof ControlRegistry>;

export const GoalCheckResult = z.object({
  runId: RunId,
  achieved: z.boolean(),
  checks: z.array(z.object({ name: z.string().min(1), passed: z.boolean(), detail: z.string().optional() })).min(1),
  at: z.string().datetime(),
}).superRefine((value, ctx) => {
  if (value.achieved !== value.checks.every(check => check.passed))
    ctx.addIssue({ code: 'custom', path: ['achieved'], message: 'achieved must agree with all checks' });
  if (new Set(value.checks.map(c => c.name)).size !== value.checks.length)
    ctx.addIssue({ code: 'custom', path: ['checks'], message: 'Check names must be unique' });
});
export type GoalCheckResult = z.infer<typeof GoalCheckResult>;
// C implements this in packages/prototype-adapter. B invokes it; D consumes evidence.
export interface PrototypeGoalAdapter {
  checkGoal(runId: string): Promise<GoalCheckResult>;
}
