import { GoalCheckResult } from '@ghostloop/contracts';

// Worker requirement for the onboarding prototype, independent of the model and generic shared verdict schema.
export const REQUIRED_GOAL_CHECKS = [
  'account_created', 'exactly_one_workspace', 'free_plan_selected', 'invite_sent', 'no_paid_trial',
] as const;

/** Every required check must be present: a checker that silently skips one cannot report success. */
export function validateGoalEvidence(raw: unknown, runId: string, required: readonly string[] = REQUIRED_GOAL_CHECKS): GoalCheckResult {
  const result = GoalCheckResult.parse(raw);
  if (result.runId !== runId) throw new Error('Goal checker returned another run ID');
  for (const name of required) {
    if (!result.checks.some(check => check.name === name)) throw new Error(`Goal checker omitted required check: ${name}`);
  }
  return result;
}

/** Bound even a custom adapter which ignores network timeouts. Never retry or infer success. */
export async function verifyPrototypeGoal(check: () => Promise<unknown>, runId: string, timeoutMs = 10_000, required: readonly string[] = REQUIRED_GOAL_CHECKS) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw = await Promise.race([
      Promise.resolve().then(check),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Goal checker timed out')), timeoutMs); }),
    ]);
    return validateGoalEvidence(raw, runId, required);
  } finally { clearTimeout(timer); }
}
