import { it, expect } from 'vitest';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIntegratedSimulationAdapter } from '../src/integration';
import { InMemoryStore } from '../../optimizer/src/store';
import { controlledScenarios } from '../src/scenarios';
import { checkGoal } from '../../../packages/prototype-adapter/src/check-goal';
import type { AgentActionEvent, BatchRequest } from '@ghostloop/contracts';

it('runs all four scenarios against C with isolated state, model-only decisions, and ordered events', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ghostloop-batch-'));
  const old = process.env.GHOSTLOOP_RUNS_DIR; process.env.GHOSTLOOP_RUNS_DIR = join(dir, 'state');
  const root = fileURLToPath(new URL('../../../apps/prototype/', import.meta.url));
  const server = await createServer({ root, configFile: join(root, 'vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } });
  try {
    await server.listen(); const baseUrl = `http://127.0.0.1:${(server.httpServer!.address() as {port:number}).port}`;
    const events: AgentActionEvent[] = [];
    const store = new InMemoryStore();
    const adapter = createIntegratedSimulationAdapter({ outputDir: join(dir, 'out'), provenance: 'mock-decisions', goalAdapter: { checkGoal: id => checkGoal(id, { baseUrl }) },
      createDecider: () => async (input, controls) => {
        const desired: Record<string, string> = { 'signup.name': 'Test User', 'signup.email': 'test@example.com', 'signup.password': 'Demo-only-Pass123!', 'workspace.name': 'Demo', 'invite.email': 'teammate@example.com' };
        for (const c of controls) {
          if (c.allowedActions.includes('type') && desired[c.elementId] && (c.inputType === 'password'
            ? !input.previousActions.some(a => a.elementId === c.elementId && a.type === 'type') : c.value !== desired[c.elementId]))
            return { type: 'type', elementId: c.elementId, value: desired[c.elementId] };
          if (c.elementId === 'signup.consent' && !c.checked) return { type: 'click', elementId: c.elementId };
        }
        const button = controls.find(c => ['signup.submit', 'workspace.continue', 'plan.free.cta', 'invite.send'].includes(c.elementId));
        return button ? { type: 'click', elementId: button.elementId } : { type: 'stop' };
      } }, store);
    const req: BatchRequest = { batchId: 'batch_four', experimentId: 'exp_test', protocolId: 'proto_test', versionId: 'ver_baseline', versionUrl: baseUrl,
      task: 'Create a Free workspace and invite a teammate without a paid trial', scenarios: controlledScenarios(), runsPerBatch: 4, maxActionsPerRun: 16, maxConcurrency: 2, hiddenGoalRef: 'SECRET_CHECKER' };
    const result = await adapter.runBatch(req, e => { events.push(e); }, new AbortController().signal);
    expect(result.cancelled).toBe(false); expect(result.runs).toHaveLength(4);
    expect(new Set(result.runs.map(r => r.runId)).size).toBe(4);
    // No scripted steps: every event is the decider's own, and low persistence finishes a clear path.
    expect(result.runs.map(r => r.outcome)).toEqual(['goal', 'goal', 'goal', 'goal']);
    expect(result.runs.flatMap(r => r.events).every(e => e.decisionSource === 'model')).toBe(true);
    expect(result.runs[3]!.stepCount).toBeGreaterThan(6);
    for (const run of result.runs) {
      expect(events.filter(e => e.runId === run.runId)).toEqual(run.events);
      expect(await store.listActions(run.runId)).toEqual(run.events);
      expect(await store.insertAction(run.events[0]!)).toBe(false);
      expect(run.events.map(e => e.seq)).toEqual(run.events.map((_, i) => i));
      expect(await fetch(`${baseUrl}/api/runs/${run.runId}/state`).then(r => r.status)).toBe(404);
      expect(await readFile(join(dir, 'out', req.batchId, run.runId, 'model-inputs.jsonl'), 'utf8')).not.toContain('SECRET_CHECKER');
    }
    expect(result.usage.inferenceCalls).toBe(result.runs.reduce((n, r) => n + r.events.filter(e => e.decisionSource === 'model').length, 0));
    await expect(adapter.runBatch({ ...req, batchId: 'batch_changed', task: 'Changed task' }, () => {}, new AbortController().signal)).rejects.toThrow('Frozen');
    const cancelled = new AbortController(); cancelled.abort();
    const empty = await adapter.runBatch({ ...req, batchId: 'batch_cancelled' }, () => {}, cancelled.signal);
    expect(empty.runs).toHaveLength(0); expect(empty.cancelled).toBe(true);
    expect((await readdir(join(dir, 'out', 'batch_cancelled'))).includes('batch.json')).toBe(true);
  } finally { await server.close(); if (old === undefined) delete process.env.GHOSTLOOP_RUNS_DIR; else process.env.GHOSTLOOP_RUNS_DIR = old; await rm(dir, { recursive: true, force: true }); }
}, 60000);
