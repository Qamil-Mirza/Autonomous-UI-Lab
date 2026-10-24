import { Scenario, type PublicAgentInput } from '@ghostloop/contracts';
import type { Decision, ObservedControl } from './actions';

const inputs = { fullName: 'Test User', email: 'test@example.com', password: 'Demo-only-Pass123!', workspaceName: 'Demo', inviteEmail: 'teammate@example.com' };
/** Stable public context and allocations: use the same plan for both versions. */
export function controlledScenarios(runsPerScenario = 1): Scenario[] {
  return [
    { id: 'scn_cost_conscious', name: 'First-time / cost-conscious', description: 'You are new to this product. Read labels carefully and avoid spending money or starting a trial.' },
    { id: 'scn_product_familiar', name: 'Returning / product-familiar', description: 'You have used similar products before and move confidently through familiar forms. This is a fresh account and workspace.' },
    { id: 'scn_invalid_email', name: 'Invalid-email recovery', description: 'You make an email typo when inviting a teammate. After submitting it, read any validation message and correct the address using inviteEmail.' },
    { id: 'scn_low_persistence', name: 'Low persistence', description: 'You have little patience. Give up after six actions or after two submissions produce validation errors.' },
  ].map(s => Scenario.parse({ ...s, inputs: { ...inputs }, runs: runsPerScenario }));
}

/** Explicit controlled interventions, recorded separately from real model decisions. */
export function scenarioPolicy(scenario: Scenario) {
  let injection: 'pending' | 'submit' | 'done' = 'pending';
  return (input: PublicAgentInput, controls: ObservedControl[]): Decision | undefined => {
    if (scenario.id === 'scn_low_persistence' && (input.previousActions.length >= 6 ||
        (input.history?.filter(h => h.result === 'validation_error' && h.action.type === 'click').length ?? 0) >= 2))
      return { type: 'stop', reason: 'Controlled low-persistence limit reached' };
    if (scenario.id !== 'scn_invalid_email') return;
    if (injection === 'pending' && controls.some(c => c.elementId === 'invite.email' && c.allowedActions.includes('type'))) {
      injection = 'submit';
      return { type: 'type', elementId: 'invite.email', value: 'invalid-email', reason: 'Controlled invalid-email injection' };
    }
    if (injection === 'submit') {
      injection = 'done';
      if (controls.some(c => c.elementId === 'invite.send' && c.allowedActions.includes('click')))
        return { type: 'click', elementId: 'invite.send', reason: 'Controlled invalid-email submission; model handles recovery' };
    }
  };
}
