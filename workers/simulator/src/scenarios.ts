import { Scenario } from '@ghostloop/contracts';

const inputs = { fullName: 'Test User', email: 'test@example.com', password: 'Demo-only-Pass123!', workspaceName: 'Demo', inviteEmail: 'teammate@example.com' };

/**
 * Stable public context and allocations: use the same plan for both versions. Scenarios differ only in persona text
 * and input data; every action in every run is the model's own decision.
 */
export function controlledScenarios(runsPerScenario = 1): Scenario[] {
  return [
    { id: 'scn_cost_conscious', name: 'First-time / cost-conscious', description: 'You are new to this product. Read labels carefully and avoid spending money or starting a trial.' },
    { id: 'scn_product_familiar', name: 'Returning / product-familiar', description: 'You have used similar products before and move confidently through familiar forms. This is a fresh account and workspace.' },
    // A realistic typo the prototype's format check rejects (missing dot); whether it gets submitted is up to the model.
    { id: 'scn_invalid_email', name: 'Invalid-email recovery', inputs: { ...inputs, inviteEmail: 'teammate@examplecom' },
      description: "You type quickly and sometimes make mistakes. The invite address in your inputs is what you wrote down from memory and may contain a typo; your teammate's real address is teammate@example.com. If the form rejects an address, read the message and correct it." },
    { id: 'scn_low_persistence', name: 'Low persistence', description: 'You have little patience. If you get stuck, see the same error again, or feel you are going in circles, stop and say why.' },
  ].map(s => Scenario.parse({ inputs: { ...inputs }, ...s, runs: runsPerScenario }));
}
