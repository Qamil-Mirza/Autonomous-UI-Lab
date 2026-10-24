import { GoalCheckResult } from '@ghostloop/contracts';

// Worker requirement, independent of the model and generic shared verdict schema.
export const REQUIRED_GOAL_CHECKS = [
  'account_created', 'exactly_one_workspace', 'free_plan_selected', 'invite_sent', 'no_paid_trial',
] as const;

export function validateGoalEvidence(raw: unknown, runId: string): GoalCheckResult {
  const result = GoalCheckResult.parse(raw);
  if (result.runId !== runId) throw new Error('Goal checker returned another run ID');
  for (const name of REQUIRED_GOAL_CHECKS) {
    if (!result.checks.some(check => check.name === name)) throw new Error(`Goal checker omitted required check: ${name}`);
  }
  return result;
}

/** Bound even a custom adapter which ignores network timeouts. Never retry or infer success. */
export async function verifyPrototypeGoal(check: () => Promise<unknown>, runId: string, timeoutMs = 10_000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw = await Promise.race([
      Promise.resolve().then(check),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Goal checker timed out')), timeoutMs); }),
    ]);
    return validateGoalEvidence(raw, runId);
  } finally { clearTimeout(timer); }
}
