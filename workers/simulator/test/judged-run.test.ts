import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BatchRequest, JudgeInput, JudgeVerdict, TrialJudge } from '@ghostloop/contracts';
import { createSimulationAdapter } from '../src/batch';
import { controlledScenarios } from '../src/scenarios';
import type { Decider } from '../src/bitdeer';
import { checkGoal } from '../../../packages/prototype-adapter/src/check-goal';

let server: ViteDevServer;
let baseUrl: string;
let dir: string;
const oldRunsDir = process.env.GHOSTLOOP_RUNS_DIR;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ghostloop-judged-'));
  process.env.GHOSTLOOP_RUNS_DIR = join(dir, 'state');
  const root = fileURLToPath(new URL('../../../apps/prototype/', import.meta.url));
  server = await createServer({ root, configFile: join(root, 'vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } });
  await server.listen();
  baseUrl = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}`;
}, 60000);
afterAll(async () => {
  await server?.close();
  if (oldRunsDir === undefined) delete process.env.GHOSTLOOP_RUNS_DIR; else process.env.GHOSTLOOP_RUNS_DIR = oldRunsDir;
  await rm(dir, { recursive: true, force: true });
});

const desired: Record<string, string> = { 'signup.name': 'Test User', 'signup.email': 'test@example.com', 'signup.password': 'Demo-only-Pass123!', 'workspace.name': 'Demo', 'invite.email': 'teammate@example.com' };

/** Completes onboarding with a reason on every action; `onConfirm` decides what happens on the last screen. */
function scripted(opts: { plan?: 'free' | 'pro'; onConfirm?: (clicked: number) => unknown } = {}): Decider {
  let confirmClicks = 0;
  return async (input, controls) => {
    for (const c of controls) {
      if (c.allowedActions.includes('type') && desired[c.elementId] && (c.inputType === 'password'
        ? !input.previousActions.some(a => a.elementId === c.elementId && a.type === 'type') : c.value !== desired[c.elementId]))
        return { type: 'type', elementId: c.elementId, value: desired[c.elementId], reason: `fill ${c.elementId}` };
      if (c.elementId === 'signup.consent' && !c.checked) return { type: 'click', elementId: c.elementId, reason: 'accept the terms' };
    }
    if (controls.some(c => c.elementId === 'confirm.done')) {
      const next = opts.onConfirm?.(confirmClicks) ?? { type: 'stop', reason: 'done: the teammate is invited' };
      if ((next as { type: string }).type === 'click') confirmClicks++;
      return next;
    }
    const order = ['signup.submit', 'workspace.continue', opts.plan === 'pro' ? 'plan.pro.cta' : 'plan.free.cta', 'invite.send'];
    const button = order.map(id => controls.find(c => c.elementId === id)).find(Boolean);
    return button ? { type: 'click', elementId: button.elementId, reason: `continue with ${button.elementId}` } : { type: 'stop', reason: 'stuck' };
  };
}

function fakeJudge(verdict: JudgeVerdict | (() => Promise<JudgeVerdict>)) {
  const calls: JudgeInput[] = [];
  const judge: TrialJudge = {
    info: { model: 'fake-judge', instructionVersion: 'test-v1' },
    judge: vi.fn(async (input: JudgeInput) => {
      calls.push(input);
      return { verdict: typeof verdict === 'function' ? await verdict() : verdict, usd: 0.03 };
    }),
  };
  return { judge, calls };
}

async function runOneTrial(decider: Decider, judge: TrialJudge, opts: { task?: string; signal?: AbortSignal } = {}) {
  const scenario = controlledScenarios().find(s => s.id === 'scn_cost_conscious')!;
  const req: BatchRequest = { batchId: `batch_${Math.random().toString(36).slice(2, 10)}`, experimentId: 'exp_test', protocolId: `proto_${Math.random().toString(36).slice(2, 10)}`,
    versionId: 'ver_baseline', versionUrl: baseUrl, task: opts.task ?? 'Create a Free workspace, invite a teammate, then go to the dashboard',
    scenarios: [{ ...scenario, runs: 1 }], runsPerBatch: 1, maxActionsPerRun: 20, maxConcurrency: 1, hiddenGoalRef: 'hidden' };
  const adapter = createSimulationAdapter({ outputDir: join(dir, 'out'), provenance: 'mock-decisions', goalAdapter: { checkGoal: id => checkGoal(id, { baseUrl }) },
    createDecider: () => decider, judge });
  return adapter.runBatch(req, () => {}, opts.signal ?? new AbortController().signal);
}

const reached = (r: JudgeVerdict['reached'], explanation = 'checked'): JudgeVerdict => ({ reached: r, explanation, evidence: ['final screen'] });

describe('judged trials', () => {
  it('keeps going after the fixed checks pass, then asks the judge once', async () => {
    const { judge, calls } = fakeJudge(reached(true));
    const result = await runOneTrial(scripted({ onConfirm: n => (n === 0 ? { type: 'click', elementId: 'confirm.done', reason: 'go to the dashboard' } : undefined) }), judge);
    const run = result.runs[0]!;
    expect(run.outcome).toBe('goal');
    expect(run.goalVerified).toBe(true);
    expect(run.events.some(e => e.action.elementId === 'confirm.done')).toBe(true);
    expect(judge.judge).toHaveBeenCalledTimes(1);
    const input = calls[0]!;
    expect(input.task).toBe('Create a Free workspace, invite a teammate, then go to the dashboard');
    expect(input.steps.every(s => s.reason)).toBe(true);
    expect(input.finalScreen).toBe('confirm');
    expect(input.appState.find(c => c.name === 'invite_sent')?.passed).toBe(true);
    expect(input.screenshots.at(-1)!.label).toBe('final screen (confirm)');
    expect(run.judge).toMatchObject({ reached: true, model: 'fake-judge', instructionVersion: 'test-v1', usd: 0.03 });
    expect(result.judge).toEqual({ model: 'fake-judge', instructionVersion: 'test-v1' });
    expect(result.usage.inferenceUsd).toBeCloseTo(0.03);
  }, 60000);

  it('fails an impossible task when the judge says not reached', async () => {
    const { judge } = fakeJudge(reached(false, 'There is no dashboard page; the trial ended on the confirmation screen.'));
    const run = (await runOneTrial(scripted(), judge)).runs[0]!;
    expect(run.outcome).toBe('agent_stop');
    expect(run.goalVerified).toBe(false);
    expect(run.judge?.explanation).toContain('no dashboard');
    expect(JSON.parse(run.goalEvidence!)).toMatchObject({ reached: false });
  }, 60000);

  it('treats an uncertain verdict as not reached', async () => {
    const { judge } = fakeJudge(reached('uncertain'));
    const run = (await runOneTrial(scripted(), judge)).runs[0]!;
    expect(run.outcome).toBe('agent_stop');
    expect(run.judge?.reached).toBe('uncertain');
  }, 60000);

  it('judges the final state, read after the last action', async () => {
    const { judge, calls } = fakeJudge(reached(false));
    // Stops before inviting: the final application state must show no invite.
    const decider: Decider = async (input, controls) => (controls.some(c => c.elementId === 'invite.send')
      ? { type: 'stop', reason: 'leaving before the invite' } : scripted()(input, controls, new AbortController().signal));
    await runOneTrial(decider, judge);
    expect(calls[0]!.finalScreen).toBe('invite');
    expect(calls[0]!.appState.find(c => c.name === 'invite_sent')?.passed).toBe(false);
    expect(calls[0]!.appState.find(c => c.name === 'account_created')?.passed).toBe(true);
  }, 60000);

  it('ends at once on a protected-rule break, without asking the judge', async () => {
    const { judge } = fakeJudge(reached(true));
    const run = (await runOneTrial(scripted({ plan: 'pro' }), judge)).runs[0]!;
    expect(run.outcome).toBe('flow_blocked');
    expect(run.protectedViolation).toBe('no_paid_trial');
    expect(run.events.at(-1)!.action.elementId).toBe('plan.pro.cta');
    expect(judge.judge).not.toHaveBeenCalled();
  }, 60000);

  it('records a failing judge as a model error', async () => {
    const { judge } = fakeJudge(async () => { throw new Error('judge unavailable'); });
    const run = (await runOneTrial(scripted(), judge)).runs[0]!;
    expect(run.outcome).toBe('model_error');
    expect(run.goalVerified).toBe(false);
  }, 60000);

  it('never judges infrastructure errors or cancellations', async () => {
    const { judge } = fakeJudge(reached(true));
    const abort = new AbortController();
    const decider: Decider = async (input, controls, signal) => {
      if (controls.some(c => c.elementId === 'confirm.done')) abort.abort();
      return scripted()(input, controls, signal);
    };
    const run = (await runOneTrial(decider, judge, { signal: abort.signal })).runs[0];
    if (run) expect(run.outcome).toBe('user_cancelled');
    expect(judge.judge).not.toHaveBeenCalled();
  }, 60000);
});
