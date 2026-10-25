import { describe, expect, it } from 'vitest';
import * as scenarios from '../src/scenarios';
import { controlledScenarios } from '../src/scenarios';
import { isEmail } from '../../../packages/prototype-adapter/src/validation';
import { SCENARIOS as DASHBOARD_SCENARIOS } from '../../../apps/dashboard/src/live/setup';

const byId = (id: string) => controlledScenarios().find(s => s.id === id)!;

describe('controlled scenarios', () => {
  it('only shape the model through persona text and input data, never scripted steps', () => {
    expect(Object.keys(scenarios)).toEqual(['controlledScenarios']);
  });

  it('give the invalid-email persona a typo the prototype rejects, and the address it meant', () => {
    const s = byId('scn_invalid_email');
    expect(isEmail(s.inputs.inviteEmail!)).toBe(false);
    expect(s.description).toContain('teammate@example.com');
    expect(isEmail('teammate@example.com')).toBe(true);
  });

  it('describe low persistence without a fixed action count', () => {
    const s = byId('scn_low_persistence');
    expect(s.description).toMatch(/patience/);
    expect(s.description).not.toMatch(/\d|six/);
  });

  it('keep the same IDs, allocations and inputs everywhere else', () => {
    const all = controlledScenarios(3);
    expect(all.map(s => s.id)).toEqual(['scn_cost_conscious', 'scn_product_familiar', 'scn_invalid_email', 'scn_low_persistence']);
    expect(all.every(s => s.runs === 3)).toBe(true);
    for (const s of all.filter(s => s.id !== 'scn_invalid_email')) expect(s.inputs.inviteEmail).toBe('teammate@example.com');
  });

  it('match the copy the dashboard sends in new experiments', () => {
    expect(DASHBOARD_SCENARIOS).toEqual(controlledScenarios().map(({ runs: _runs, ...s }) => s));
  });
});
