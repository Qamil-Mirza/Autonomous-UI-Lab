import { describe, expect, it } from 'vitest';
import type { AgentActionEvent, GoalCheckResult, JudgeVerdict, RunOutcome } from '@ghostloop/contracts';
import { buildJudgeInput, keyScreenshots, scoreTrial, vetoViolation } from '../src/judging';
import { controlledScenarios } from '../src/scenarios';

const scenario = controlledScenarios()[0]!;
const event = (seq: number, over: Partial<AgentActionEvent> = {}): AgentActionEvent => ({
  runId: 'run_a', seq, at: new Date(Date.UTC(2026, 9, 25, 0, 0, seq)).toISOString(), versionId: 'ver_baseline',
  screenBefore: 'signup', screenAfter: 'signup', action: { type: 'click', elementId: 'signup.submit', reason: 'submit the form' },
  result: 'ok', viewport: { width: 1280, height: 800 }, decisionSource: 'model', ...over,
});
const state = (checks: [string, boolean][]): GoalCheckResult => ({ runId: 'run_a', achieved: checks.every(([, p]) => p),
  checks: checks.map(([name, passed]) => ({ name, passed, detail: passed ? 'ok' : 'failed' })), at: new Date().toISOString() } as GoalCheckResult);

describe('buildJudgeInput', () => {
  it('redacts the scenario password from typed values and uses visible labels', () => {
    const input = buildJudgeInput({ task: 'Do it', scenario,
      events: [
        event(0, { action: { type: 'type', elementId: 'signup.password', value: scenario.inputs.password!, reason: 'enter password' } }),
        event(1, { action: { type: 'type', elementId: 'invite.email', value: 'teammate@example.com', reason: 'invite' } }),
        event(2, { action: { type: 'click', elementId: 'unknown.thing', reason: 'try' } }),
      ],
      labels: new Map([['invite.email', 'Teammate email'], ['signup.password', 'Password']]), secretElements: new Set(),
      localShots: [{ path: '/tmp/0.png', screen: 'signup' }], finalScreen: 'signup', appState: undefined });
    expect(input.steps.map(s => [s.target, s.value])).toEqual([['Password', '[redacted]'], ['Teammate email', 'teammate@example.com'], ['unknown.thing', undefined]]);
    expect(input.steps[0]!.reason).toBe('enter password');
    expect(JSON.stringify(input)).not.toContain(scenario.inputs.password!);
    expect(input.scenario).toEqual({ description: scenario.description, inputs: { ...scenario.inputs, password: '[redacted]' } });
  });

  it('redacts anything typed into a password field and scrubs the password from values and reasons', () => {
    const secret = scenario.inputs.password!;
    const input = buildJudgeInput({ task: 'Do it', scenario,
      events: [
        event(0, { action: { type: 'type', elementId: 'signup.password', value: 'Typo-Pass9!', reason: 'retype the password' } }),
        event(1, { action: { type: 'type', elementId: 'signup.name', value: `${secret} `, reason: `typing ${secret} by mistake` } }),
      ],
      labels: new Map(), secretElements: new Set(['signup.password']), localShots: [], finalScreen: 'signup', appState: undefined });
    expect(input.steps[0]!.value).toBe('[redacted]');
    expect(JSON.stringify(input)).not.toContain(secret);
    expect(JSON.stringify(input)).not.toContain('Typo-Pass9!');
    expect(input.steps[1]!.reason).toBe('typing [redacted] by mistake');
  });

  it('lists screens visited in order without repeats and carries the final app state', () => {
    const screens = ['signup', 'workspace', 'plan', 'workspace', 'plan'];
    const input = buildJudgeInput({ task: 'Do it', scenario,
      events: screens.slice(1).map((s, i) => event(i, { screenBefore: screens[i]!, screenAfter: s })),
      labels: new Map(), secretElements: new Set(), localShots: [], finalScreen: 'plan', appState: state([['invite_sent', false], ['no_paid_trial', true]]) });
    expect(input.screens).toEqual(['signup', 'workspace', 'plan']);
    expect(input.finalScreen).toBe('plan');
    expect(input.appState).toEqual([{ name: 'invite_sent', passed: false, detail: 'failed' }, { name: 'no_paid_trial', passed: true, detail: 'ok' }]);
  });
});

describe('keyScreenshots', () => {
  it('keeps the final screenshot and at most six, in trial order', () => {
    const screens = ['signup', 'workspace', 'plan', 'invite'];
    const shots = Array.from({ length: 20 }, (_, i) => ({ path: `/tmp/${i}.png`, screen: screens[Math.floor(i / 5)]! }));
    const picked = keyScreenshots(shots);
    expect(picked).toHaveLength(4);
    expect(picked.at(-1)).toEqual({ label: 'final screen (invite)', path: '/tmp/19.png' });
    expect(picked.slice(0, 3)).toEqual([
      { label: 'before leaving signup', path: '/tmp/4.png' },
      { label: 'before leaving workspace', path: '/tmp/9.png' },
      { label: 'before leaving plan', path: '/tmp/14.png' },
    ]);
    const bouncing = Array.from({ length: 20 }, (_, i) => ({ path: `/tmp/${i}.png`, screen: i % 2 ? 'a' : 'b' }));
    const capped = keyScreenshots(bouncing);
    expect(capped).toHaveLength(6);
    expect(capped.at(-1)!.path).toBe('/tmp/19.png');
    expect(capped.map(s => Number(s.path.match(/\d+/)![0]))).toEqual([14, 15, 16, 17, 18, 19]);
    expect(keyScreenshots([])).toEqual([]);
  });
});

describe('vetoViolation', () => {
  it('finds a broken protected rule only when it is in the list', () => {
    const broken = state([['invite_sent', true], ['no_paid_trial', false]]);
    expect(vetoViolation(broken, ['no_paid_trial'])).toBe('no_paid_trial');
    expect(vetoViolation(broken, [])).toBeUndefined();
    expect(vetoViolation(state([['no_paid_trial', true]]), ['no_paid_trial'])).toBeUndefined();
    expect(vetoViolation(undefined, ['no_paid_trial'])).toBeUndefined();
  });
});

describe('scoreTrial', () => {
  const v = (reached: JudgeVerdict['reached']): JudgeVerdict => ({ reached, explanation: 'x', evidence: [] });
  it.each<[RunOutcome, Partial<Parameters<typeof scoreTrial>[0]>, RunOutcome, boolean]>([
    ['agent_stop', { verdict: v(true) }, 'goal', true],
    ['agent_stop', { verdict: v('uncertain') }, 'agent_stop', false],
    ['step_limit', { verdict: v(false) }, 'step_limit', false],
    ['agent_stop', { violation: 'no_paid_trial', verdict: v(true) }, 'flow_blocked', false],
    ['agent_stop', { judgeError: 'boom' }, 'model_error', false],
    ['browser_error', { verdict: v(true) }, 'browser_error', false],
    ['user_cancelled', { verdict: v(true) }, 'user_cancelled', false],
    ['flow_blocked', { verdict: v(true) }, 'goal', true],
  ])('%s with %o → %s', (ended, extra, outcome, goalVerified) => {
    expect(scoreTrial({ ended, ...extra })).toMatchObject({ outcome, goalVerified });
  });

  it('reports a protected violation only when it is what failed the trial', () => {
    expect(scoreTrial({ ended: 'agent_stop', violation: 'no_paid_trial' }).protectedViolation).toBe('no_paid_trial');
    expect(scoreTrial({ ended: 'user_cancelled', violation: 'no_paid_trial' }).protectedViolation).toBeUndefined();
    expect(scoreTrial({ ended: 'browser_error', violation: 'no_paid_trial' }).protectedViolation).toBeUndefined();
  });
});
