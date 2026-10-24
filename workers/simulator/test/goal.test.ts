import { describe, it, expect } from 'vitest';
import { REQUIRED_GOAL_CHECKS, validateGoalEvidence, verifyPrototypeGoal } from '../src/goal';
const good = () => ({ runId: 'run_test', achieved: true, at: new Date().toISOString(),
  checks: REQUIRED_GOAL_CHECKS.map(name => ({ name, passed: true, detail: 'Test evidence' })) });
describe('independent goal evidence boundary', () => {
  it('requires all onboarding checks for the current run', () => {
    expect(validateGoalEvidence(good(), 'run_test').achieved).toBe(true);
    expect(() => validateGoalEvidence(good(), 'run_other')).toThrow('another run');
    for (const name of REQUIRED_GOAL_CHECKS) {
      const missing = good(); missing.checks = missing.checks.filter(c => c.name !== name);
      expect(() => validateGoalEvidence(missing, 'run_test')).toThrow('omitted');
      const failed = good(); failed.checks.find(c => c.name === name)!.passed = false;
      expect(() => validateGoalEvidence(failed, 'run_test')).toThrow();
      failed.achieved = false;
      expect(validateGoalEvidence(failed, 'run_test').achieved).toBe(false);
    }
  });
  it('rejects bare model claims, duplicates, and malformed evidence', () => {
    for (const value of [true, { achieved: true }, { ...good(), checks: [good().checks[0], good().checks[0]] },
      { ...good(), at: 'yesterday' }]) expect(() => validateGoalEvidence(value, 'run_test')).toThrow();
  });
  it('bounds stalled adapters and propagates checker faults', async () => {
    await expect(verifyPrototypeGoal(() => new Promise(() => {}), 'run_test', 10)).rejects.toThrow('timed out');
    await expect(verifyPrototypeGoal(async () => { throw new Error('run missing'); }, 'run_test')).rejects.toThrow('run missing');
  });
});
