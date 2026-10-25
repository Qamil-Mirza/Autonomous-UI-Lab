import { Scenario, type PublicAgentInput } from '@ghostloop/contracts';
import type { Decision, ObservedControl } from './actions';

const inputs = { fullName: 'Test User', email: 'test@example.com', password: 'Demo-only-Pass123!', workspaceName: 'Demo', inviteEmail: 'teammate@example.com' };
/** Stable public context and allocations: use the same plan for both versions. */
export function controlledScenarios(runsPerScenario = 1): Scenario[] {
  return [
    { id: 'scn_cost_conscious', name: 'First-time / cost-conscious', description: 'You are new to this product. Read labels carefully and avoid spending money or starting a trial.' },
    { id: 'scn_product_familiar', name: 'Returning / product-familiar', description: 'You have used similar products before and move confidently through familiar forms. This is a fresh account and workspace.' },
    { id: 'scn_invalid_email', name: 'Invalid-email recovery', description: 'You make an email typo when inviting a teammate. After submitting it, read any validation message and correct the address using inviteEmail.' },
    { id: 'scn_low_persistence', name: 'Low persistence', description: 'You have little patience. You give up when you get stuck: after two submissions produce validation errors, or after a few actions in a row get you nowhere.' },
  ].map(s => Scenario.parse({ ...s, inputs: { ...inputs }, runs: runsPerScenario }));
}

/** The low-persistence give-up rule: patient enough for a clear path, not for friction. */
export const LOW_PERSISTENCE = { failedSubmissions: 2, unproductiveInARow: 3, maxActions: 14 } as const;

type History = NonNullable<PublicAgentInput['history']>;
/** An action that got nowhere: it failed or had no effect, or it went back to a screen already visited. */
function unproductive(h: History[number], earlier: History): boolean {
  if (h.result !== 'ok') return true;
  if (h.screenAfter === h.screenBefore) return false;
  return earlier.some(e => e.screenBefore === h.screenAfter);
}
function lowPersistenceReason(input: PublicAgentInput): string | undefined {
  const history = input.history ?? [];
  if (history.filter(h => h.result === 'validation_error' && h.action.type === 'click').length >= LOW_PERSISTENCE.failedSubmissions)
    return 'Low-persistence scenario: gave up after two submissions produced validation errors';
  const recent = history.slice(-LOW_PERSISTENCE.unproductiveInARow);
  if (recent.length === LOW_PERSISTENCE.unproductiveInARow && recent.every((h, i) => unproductive(h, history.slice(0, history.length - recent.length + i))))
    return `Low-persistence scenario: gave up after ${LOW_PERSISTENCE.unproductiveInARow} actions in a row got nowhere`;
  if (input.previousActions.length >= LOW_PERSISTENCE.maxActions)
    return `Low-persistence scenario: gave up after ${LOW_PERSISTENCE.maxActions} actions`;
}

/** Explicit controlled interventions, recorded separately from real model decisions. */
export function scenarioPolicy(scenario: Scenario) {
  let injection: 'pending' | 'submit' | 'done' = 'pending';
  return (input: PublicAgentInput, controls: ObservedControl[]): Decision | undefined => {
    if (scenario.id === 'scn_low_persistence') {
      const reason = lowPersistenceReason(input);
      if (reason) return { type: 'stop', reason };
    }
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
