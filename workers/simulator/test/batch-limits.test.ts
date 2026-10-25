import { vi, it, expect, beforeEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunOptions } from '../src/run';
import type { BatchRequest } from '@ghostloop/contracts';
const state = vi.hoisted(() => ({ active: 0, peak: 0, started: 0, providerCalls: 0, scenarios: [] as string[], outcomeFor: undefined as undefined | ((id: number) => string) }));
vi.mock('../src/run', async () => {
  const { AgentRunResult } = await import('@ghostloop/contracts');
  return { runOne: async (o: RunOptions) => {
    state.active++; state.peak = Math.max(state.peak, state.active); const id = ++state.started; state.scenarios.push(o.scenario!.id);
    try {
      try { await o.decide({} as never, [], o.signal); } catch { /* cancellation recorded below */ }
      await new Promise(r => setTimeout(r, 20));
      const outcome = o.signal.aborted ? 'user_cancelled' : (state.outcomeFor?.(id) ?? 'agent_stop');
      return AgentRunResult.parse({ schemaVersion: '1.0.0', runId: `run_${id}`, experimentId: o.experimentId, protocolId: o.protocolId,
        scenarioId: o.scenario!.id, batchId: o.batchId, versionId: o.prototype!.versionId, events: [], goalVerified: false,
        stepCount: 0, outcome, terminalScreen: 'test', screenshots: [],
        behaviorallyValid: outcome === 'agent_stop', startedAt: new Date().toISOString(), endedAt: new Date().toISOString() });
    } finally { state.active--; }
  } };
});
import { createSimulationAdapter } from '../src/batch';
import { controlledScenarios } from '../src/scenarios';
import { ModelResponseError } from '../src/decision';
beforeEach(() => Object.assign(state, { active: 0, peak: 0, started: 0, providerCalls: 0, scenarios: [], outcomeFor: undefined }));
const req: BatchRequest = { batchId: 'batch_test', experimentId: 'exp_test', protocolId: 'proto_test', versionId: 'ver_baseline',
  versionUrl: 'http://localhost:5173', task: 'Test task', scenarios: controlledScenarios(2), runsPerBatch: 8,
  maxActionsPerRun: 16, maxConcurrency: 2, hiddenGoalRef: 'hidden' };
async function testBatch(extra: Parameters<typeof createSimulationAdapter>[0] extends infer T ? Partial<T> : never = {}, signal = new AbortController().signal, maxConcurrency = req.maxConcurrency) {
  const dir = await mkdtemp(join(tmpdir(), 'ghostloop-limits-'));
  try { return await createSimulationAdapter({ outputDir: dir, provenance: 'mock-decisions', goalAdapter: { checkGoal: async () => { throw new Error('unused'); } },
    createDecider: () => async () => { state.providerCalls++; return { type: 'stop' }; }, ...extra }).runBatch({ ...req, maxConcurrency }, () => {}, signal); }
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
it('interleaves scenarios so an early stop still covers every scenario', async () => {
  await testBatch();
  expect(new Set(state.scenarios.slice(0, 4)).size).toBe(4);
  expect(state.scenarios.slice(0, 4)).toEqual(state.scenarios.slice(4, 8));
});
it('keeps going after a single technical error', async () => {
  state.outcomeFor = id => (id === 1 ? 'model_error' : 'agent_stop');
  const result = await testBatch();
  expect(result.cancelled).toBe(false); expect(result.runs).toHaveLength(8);
  expect(result.runs.filter(r => r.outcome === 'model_error')).toHaveLength(1);
});
it('stops after three technical errors in a row', async () => {
  state.outcomeFor = () => 'browser_error';
  const result = await testBatch();
  expect(result.cancelled).toBe(true); expect(state.started).toBeLessThan(8); expect(state.active).toBe(0);
});
it('resets the error streak when a trial completes normally', async () => {
  state.outcomeFor = id => (id % 3 === 0 ? 'agent_stop' : 'model_error');
  const result = await testBatch({}, undefined, 1);
  expect(result.cancelled).toBe(false); expect(result.runs).toHaveLength(8);
});
it('stops at once when the model provider is out of credits', async () => {
  const result = await testBatch({ createDecider: () => async () => { state.providerCalls++; throw new ModelResponseError('Bitdeer 402: Model Studio credits are needed', false); } });
  expect(result.cancelled).toBe(true); expect(state.started).toBe(2); expect(state.active).toBe(0);
});
