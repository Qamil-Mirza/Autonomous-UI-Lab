import { describe, it, expect } from 'vitest';
import { ControlRegistry, GoalCheckResult } from '../src/prototype';
describe('prototype handoff contracts', () => {
  it('strips protected metadata from the public registry', () => {
    const registry = ControlRegistry.parse({ versionId: 'ver_baseline', elements: [{ elementId: 'plan.free.cta', screen: 'plan', role: 'button', label: 'Continue', protected: true, categories: ['pricing'], supportedOps: ['set_label'] }] });
    expect(registry.elements[0]).toEqual({ elementId: 'plan.free.cta', screen: 'plan', role: 'button', label: 'Continue' });
  });
  it('rejects unsupported success and empty or duplicate checks', () => {
    const base = { runId: 'run_example', achieved: true, at: new Date().toISOString() };
    expect(GoalCheckResult.safeParse({ ...base, checks: [] }).success).toBe(false);
    expect(GoalCheckResult.safeParse({ ...base, checks: [{ name: 'Free selected', passed: false }] }).success).toBe(false);
    expect(GoalCheckResult.safeParse({ ...base, checks: [{ name: 'Free selected', passed: true }, { name: 'Free selected', passed: true }] }).success).toBe(false);
  });
});
