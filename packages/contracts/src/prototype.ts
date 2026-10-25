import { z } from 'zod';
import { VersionId } from './ids';
import type { GoalCheckResult } from './goal';
export { GoalCheckResult } from './goal';

// Public registry entries: deliberately allowlisted; mutation-policy fields are stripped.
export const ControlRegistryEntry = z.object({
  elementId: z.string().min(1), screen: z.string().min(1), role: z.string().min(1), label: z.string(),
});
export type ControlRegistryEntry = z.infer<typeof ControlRegistryEntry>;
export const ControlRegistry = z.object({ versionId: VersionId, elements: z.array(ControlRegistryEntry) });
export type ControlRegistry = z.infer<typeof ControlRegistry>;

// C implements this in packages/prototype-adapter. B invokes it; D consumes evidence.
export interface PrototypeGoalAdapter {
  checkGoal(runId: string): Promise<GoalCheckResult>;
}
