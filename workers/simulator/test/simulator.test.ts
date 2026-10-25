import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateDecision, type ObservedControl } from '../src/actions';
import { startFixture } from '../src/fixture';
import { runPractice } from '../src/run';
import type { Decider } from '../src/bitdeer';

const control: ObservedControl = { elementId: 'name', role: 'textbox', label: 'Name', enabled: true,
  allowedActions: ['type'], bounds: { x: 0, y: 0, width: 100, height: 30 } };
describe('action boundary', () => {
  it('rejects invented IDs, incompatible actions, and model code', () => {
    for (const raw of [
      { type: 'click', elementId: 'invented' }, { type: 'click', elementId: 'name' },
      { type: 'type', elementId: 'name' }, { type: 'stop', javascript: 'alert(1)' },
      { type: 'type', elementId: 'name', value: 'Demo', extra: true },
    ]) expect(() => validateDecision(raw, [control])).toThrow();
    expect(validateDecision({ type: 'type', elementId: 'name', value: 'Demo' }, [control]).type).toBe('type');
  });
  it('rejects disabled targets and unknown select values', () => {
    expect(() => validateDecision({ type: 'type', elementId: 'name', value: 'Demo' }, [{ ...control, enabled: false }])).toThrow();
    expect(() => validateDecision({ type: 'select', elementId: 'name', value: 'paid' }, [{ ...control, allowedActions: ['select'], options: ['free'] }])).toThrow();
  });
});

async function run(decide: Decider, extra: Partial<Parameters<typeof runPractice>[0]> = {}) {
  const fixture = await startFixture();
  const dir = await mkdtemp(join(tmpdir(), 'ghostloop-test-'));
  try {
    return await runPractice({ url: fixture.url, outputDir: dir, decide, signal: new AbortController().signal,
      provenance: 'mock-decisions', ...extra });
  } finally {
    await fixture.close();
    await rm(dir, { recursive: true, force: true });
  }
}
const success: Decider = async input => input.previousActions.length === 0
  ? { type: 'type', elementId: 'workspace-name', value: 'Demo' }
  : { type: 'click', elementId: 'create-workspace' };

describe('real browser lifecycle with mock decisions', () => {
  it('executes two actions, verifies state, and keeps runs isolated', async () => {
    const first = await run(success);
    const second = await run(success);
    for (const result of [first, second]) {
      expect(result.outcome).toBe('goal');
      expect(result.stepCount).toBe(2);
      expect(result.events.map(e => e.seq)).toEqual([0, 1]);
      expect(result.screenshots).toHaveLength(3);
      expect(result.events[1]?.pointer).toBeDefined();
    }
    expect(first.runId).not.toBe(second.runId);
  }, 30_000);
  it('never accepts the model saying done as proof', async () => {
    const result = await run(async () => ({ type: 'stop', reason: 'Task succeeded' }));
    expect(result.outcome).toBe('agent_stop');
    expect(result.goalVerified).toBe(false);
    expect(result.stepCount).toBe(0);
  }, 15_000);
  it('distinguishes step exhaustion and a model fault', async () => {
    expect((await run(success, { maxActions: 1 })).outcome).toBe('step_limit');
    const invalid = await run(async () => ({ type: 'click', elementId: 'invented' }));
    expect(invalid.outcome).toBe('model_error');
    expect(invalid.events).toHaveLength(0);
    expect(invalid.behaviorallyValid).toBe(false);
  }, 30_000);
  it('preserves partial evidence on cancellation', async () => {
    const controller = new AbortController();
    const result = await run(async (...args) => {
      if (args[0].previousActions.length) { controller.abort(); throw new Error('Cancelled'); }
      return success(...args);
    }, { signal: controller.signal });
    expect(result.outcome).toBe('user_cancelled');
    expect(result.events).toHaveLength(1);
  }, 15_000);
  it('classifies browser startup/navigation errors separately', async () => {
    const result = await run(success, { url: 'http://127.0.0.1:1/' });
    expect(result.outcome).toBe('browser_error');
  }, 15_000);
});
