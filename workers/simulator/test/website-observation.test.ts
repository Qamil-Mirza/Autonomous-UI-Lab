import { it, expect } from 'vitest';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prototypeIntegration } from '../src/prototype';
import { runPractice } from '../src/run';
import { checkGoal } from '../../../packages/prototype-adapter/src/check-goal';

it.each(['free', 'pro'] as const)('observes C’s real website and independently verifies the %s plan outcome', async plan => {
  const temp = await mkdtemp(join(tmpdir(), 'ghostloop-real-observer-'));
  const previousRunsDir = process.env.GHOSTLOOP_RUNS_DIR;
  process.env.GHOSTLOOP_RUNS_DIR = join(temp, 'state');
  const root = fileURLToPath(new URL('../../../apps/prototype/', import.meta.url));
  const server = await createServer({ root, configFile: join(root, 'vite.config.ts'),
    logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } });
  try {
    await server.listen();
    const address = server.httpServer!.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const prototype = prototypeIntegration(baseUrl, 'ver_baseline', { checkGoal: runId => checkGoal(runId, { baseUrl }) });
    // Explicit mock decisions test the adapter without charging or crediting Bitdeer.
    const actions = [
      { type: 'type', elementId: 'signup.name', value: 'Test User' },
      { type: 'type', elementId: 'signup.email', value: 'test@example.com' },
      { type: 'type', elementId: 'signup.password', value: 'Test-password-123' },
      { type: 'click', elementId: 'signup.consent' },
      { type: 'click', elementId: 'signup.submit' },
      { type: 'type', elementId: 'workspace.name', value: 'Observer test' },
      { type: 'click', elementId: 'workspace.continue' },
      { type: 'click', elementId: `plan.${plan}.cta` },
      { type: 'type', elementId: 'invite.email', value: 'invalid-email' },
      { type: 'click', elementId: 'invite.send' },
      { type: 'type', elementId: 'invite.email', value: 'teammate@example.com' },
      { type: 'click', elementId: 'invite.send' },
    ];
    const result = await runPractice({ url: baseUrl, prototype, outputDir: join(temp, 'artifacts'),
      signal: new AbortController().signal, provenance: 'mock-decisions', maxActions: 16,
      decide: async (input, controls) => {
        const step = input.previousActions.length;
        expect(input.remainingActions).toBe(16 - step);
        expect(input.history).toHaveLength(step);
        if (step === 10) {
          expect(input.visibleUI?.alerts.length).toBeGreaterThan(0);
          expect(input.history?.[9]?.result).toBe('validation_error');
          expect(input.history?.[9]?.alerts.length).toBeGreaterThan(0);
        }
        expect(JSON.stringify(input)).not.toContain('goalEvidence');
        expect(JSON.stringify(input)).not.toContain('hiddenGoal');
        if (step === actions.length && plan === 'pro') return { type: 'stop', reason: 'The confirmation screen says I succeeded' };
        const action = actions[step];
        expect(action).toBeDefined();
        expect(controls.map(c => c.elementId)).toContain(action!.elementId);
        expect(controls.map(c => c.elementId)).not.toContain('decor.sparkle');
        expect(controls.map(c => c.elementId)).not.toContain('plan.free.note');
        expect(controls.every(c => c.bounds.x >= 0 && c.bounds.y >= 0 && c.bounds.x + c.bounds.width <= 1280 && c.bounds.y + c.bounds.height <= 800)).toBe(true);
        expect(JSON.stringify(controls)).not.toContain('protected');
        expect(JSON.stringify(controls)).not.toContain('Test-password-123');
        if (action!.elementId === 'plan.free.cta') expect(controls.find(c => c.elementId === action!.elementId)?.label).toBe('Continue');
        return action;
      } });
    expect(result.outcome).toBe(plan === 'free' ? 'goal' : 'agent_stop');
    expect(result.goalVerified).toBe(plan === 'free');
    const evidence = JSON.parse(result.goalEvidence!);
    expect(evidence.checks.filter((c: { passed: boolean }) => !c.passed).map((c: { name: string }) => c.name))
      .toEqual(plan === 'free' ? [] : ['free_plan_selected', 'no_paid_trial']);
    if (plan === 'pro') expect(result.terminalScreen).toBe('confirm');
    expect(result.stepCount).toBe(12);
    expect(result.events[9]?.result).toBe('validation_error');
    const observations = await Promise.all(result.screenshots.map(async s => JSON.parse(await readFile(`${s.uri}.observation.json`, 'utf8'))));
    expect(new Set(observations.map(o => o.screenId))).toEqual(new Set(['signup', 'workspace', 'plan', 'invite', 'confirm']));
    expect(observations[10].alerts.length).toBeGreaterThan(0);
    expect(observations.every(o => o.url.includes(`run=${result.runId}`))).toBe(true);
    expect((await fetch(`${baseUrl}/api/runs/${result.runId}/state`)).status).toBe(404);
  } finally {
    await server.close();
    if (previousRunsDir === undefined) delete process.env.GHOSTLOOP_RUNS_DIR;
    else process.env.GHOSTLOOP_RUNS_DIR = previousRunsDir;
    await rm(temp, { recursive: true, force: true });
  }
}, 60000);
