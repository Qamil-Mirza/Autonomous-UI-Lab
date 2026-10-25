import { describe, expect, it } from 'vitest';
import type { PublicAgentInput } from '@ghostloop/contracts';
import { controlledScenarios, LOW_PERSISTENCE, scenarioPolicy } from '../src/scenarios';

type Step = { screenBefore: string; screenAfter: string; result: NonNullable<PublicAgentInput['history']>[number]['result']; click?: boolean };
const lowPersistence = controlledScenarios().find(s => s.id === 'scn_low_persistence')!;

/** Runs the policy after each step and returns the step count at which it gave up (or undefined). */
function giveUpAfter(steps: Step[]): string | undefined {
  const policy = scenarioPolicy(lowPersistence);
  const history: NonNullable<PublicAgentInput['history']> = [];
  for (let i = 0; i <= steps.length; i++) {
    const input = { previousActions: history.map(h => h.action), history } as unknown as PublicAgentInput;
    const decision = policy(input, []);
    if (decision?.type === 'stop') return `${i}: ${decision.reason}`;
    const s = steps[i];
    if (!s) break;
    history.push({ seq: i, action: { type: s.click ? 'click' : 'type', elementId: 'x' }, screenBefore: s.screenBefore, screenAfter: s.screenAfter, result: s.result, alerts: [] });
  }
  return undefined;
}

const ok = (screen: string, next = screen): Step => ({ screenBefore: screen, screenAfter: next, result: 'ok' });
// The successful path from real runs: five signup steps, then workspace, plan, invite (about 10–12 actions).
const happyPath: Step[] = [ok('signup'), ok('signup'), ok('signup'), ok('signup'), { ...ok('signup', 'workspace'), click: true },
  ok('workspace'), { ...ok('workspace', 'plan'), click: true }, { ...ok('plan', 'invite'), click: true }, ok('invite'), { ...ok('invite', 'confirm'), click: true }];

describe('low-persistence scenario', () => {
  it('finishes a clear path that takes more than six actions', () => {
    expect(giveUpAfter(happyPath)).toBeUndefined();
  });

  it('gives up after two submissions produce validation errors', () => {
    const failed: Step = { screenBefore: 'invite', screenAfter: 'invite', result: 'validation_error', click: true };
    expect(giveUpAfter([...happyPath.slice(0, 8), failed, ok('invite'), failed, ok('invite')])).toMatch(/^11: .*two submissions/);
  });

  it('gives up after three unproductive actions in a row', () => {
    const stuck: Step = { screenBefore: 'plan', screenAfter: 'plan', result: 'no_effect' };
    expect(giveUpAfter([...happyPath.slice(0, 7), stuck, stuck, stuck, ok('plan')])).toMatch(/^10: .*nowhere/);
  });

  it('counts going back to an earlier screen as unproductive', () => {
    const back = (from: string, to: string): Step => ({ screenBefore: from, screenAfter: to, result: 'ok', click: true });
    const loop = [back('plan', 'workspace'), back('workspace', 'plan'), back('plan', 'workspace')];
    expect(giveUpAfter([...happyPath.slice(0, 7), ...loop, ok('workspace')])).toMatch(/^10: .*nowhere/);
  });

  it(`gives up once a trial takes ${LOW_PERSISTENCE.maxActions} actions`, () => {
    const typing = Array.from({ length: 20 }, () => ok('signup'));
    expect(giveUpAfter(typing)).toMatch(new RegExp(`^${LOW_PERSISTENCE.maxActions}: `));
  });

  it('describes the rule to the model the way it is enforced', () => {
    expect(lowPersistence.description).not.toMatch(/six actions/);
    expect(lowPersistence.description).toMatch(/two/);
  });
});
