import { vi, it, expect, beforeEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunOptions } from '../src/run';
import type { BatchRequest } from '@ghostloop/contracts';
const state = vi.hoisted(() => ({ active: 0, peak: 0, started: 0, providerCalls: 0 }));
vi.mock('../src/run', async () => {
  const { AgentRunResult } = await import('@ghostloop/contracts');
  return { runOne: async (o: RunOptions) => {
    state.active++; state.peak = Math.max(state.peak, state.active); const id = ++state.started;
    try {
      try { await o.decide({} as never, [], o.signal); } catch { /* cancellation recorded below */ }
      await new Promise(r => setTimeout(r, 20));
      return AgentRunResult.parse({ schemaVersion: '1.0.0', runId: `run_${id}`, experimentId: o.experimentId, protocolId: o.protocolId,
        scenarioId: o.scenario!.id, batchId: o.batchId, versionId: o.prototype!.versionId, events: [], goalVerified: false,
        stepCount: 0, outcome: o.signal.aborted ? 'user_cancelled' : 'agent_stop', terminalScreen: 'test', screenshots: [],
        behaviorallyValid: !o.signal.aborted, startedAt: new Date().toISOString(), endedAt: new Date().toISOString() });
    } finally { state.active--; }
  } };
});
import { createSimulationAdapter } from '../src/batch';
import { controlledScenarios } from '../src/scenarios';
beforeEach(() => Object.assign(state, { active: 0, peak: 0, started: 0, providerCalls: 0 }));
const req: BatchRequest = { batchId: 'batch_test', experimentId: 'exp_test', protocolId: 'proto_test', versionId: 'ver_baseline',
  versionUrl: 'http://localhost:5173', task: 'Test task', scenarios: controlledScenarios(2), runsPerBatch: 8,
  maxActionsPerRun: 16, maxConcurrency: 2, hiddenGoalRef: 'hidden' };
async function testBatch(extra: Parameters<typeof createSimulationAdapter>[0] extends infer T ? Partial<T> : never = {}, signal = new AbortController().signal) {
  const dir = await mkdtemp(join(tmpdir(), 'ghostloop-limits-'));
  try { return await createSimulationAdapter({ outputDir: dir, provenance: 'mock-decisions', goalAdapter: { checkGoal: async () => { throw new Error('unused'); } },
    createDecider: () => async () => { state.providerCalls++; return { type: 'stop' }; }, ...extra }).runBatch(req, () => {}, signal); }
  finally { await rm(dir, { recursive: true, force: true }); }
}
it('caps concurrent sessions and waits for every started session', async () => {
  const result = await testBatch(); expect(result.runs).toHaveLength(8); expect(state.peak).toBe(2);
  expect(state.active).toBe(0); expect(result.usage.inferenceCalls).toBe(8);
});
it('reserves call budgets synchronously across concurrent sessions', async () => {
  const result = await testBatch({ maxInferenceCalls: 1 }); expect(result.cancelled).toBe(true);
  expect(state.providerCalls).toBe(1); expect(result.usage.inferenceCalls).toBe(1);
  expect(state.started).toBe(2); expect(state.active).toBe(0);
});
it('stops queue admission on external cancellation', async () => {
  const abort = new AbortController();
  const result = await testBatch({ createDecider: () => async () => { abort.abort(); return { type: 'stop' }; } }, abort.signal);
  expect(result.cancelled).toBe(true); expect(state.started).toBeLessThan(8); expect(state.active).toBe(0);
});
it('rejects dollar budgets when live pricing is unknown', async () => {
  await expect(testBatch({ provenance: 'live-bitdeer', maxInferenceUsd: 1 })).rejects.toThrow('call-cost estimate');
});
it('enforces an estimated dollar cap before sending a request', async () => {
  const result = await testBatch({ provenance: 'live-bitdeer', estimatedUsdPerCall: 0.1, maxInferenceUsd: 0.05 });
  expect(result.cancelled).toBe(true); expect(state.providerCalls).toBe(0);
  expect(result.usage.costEstimated).toBe(true);
});
it('cancels the batch on its wall-clock deadline', async () => {
  const result = await testBatch({ maxWallClockMs: 5 });
  expect(result.cancelled).toBe(true); expect(state.started).toBeLessThan(8); expect(state.active).toBe(0);
});
