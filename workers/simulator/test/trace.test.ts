import { it, expect } from 'vitest';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentActionEvent } from '@ghostloop/contracts';
import { runOne } from '../src/run';
import { startFixture } from '../src/fixture';

it('publishes durable screenshots before ordered events and persists the identical replay', async () => {
  const fixture = await startFixture(); const dir = await mkdtemp(join(tmpdir(), 'ghostloop-trace-'));
  const received: AgentActionEvent[] = []; const published = new Set<string>();
  let terminalCount = 0;
  try {
    const result = await runOne({ url: fixture.url, outputDir: dir, signal: new AbortController().signal,
      provenance: 'mock-decisions', experimentId: 'exp_trace', protocolId: 'proto_trace', batchId: 'batch_trace',
      publishScreenshot: async local => {
        await access(local.uri);
        const uri = `https://artifacts.example/${local.uri.split('/').slice(-2).join('/')}`;
        published.add(uri); return { ...local, uri };
      },
      onEvent: async e => {
        expect(e.seq).toBe(received.length);
        expect(published.has(e.screenshotBefore!.uri)).toBe(true);
        expect(published.has(e.screenshot!.uri)).toBe(true);
        const persisted = (await readFile(join(dir, e.runId, 'events.jsonl'), 'utf8')).trim().split('\n').map(s => JSON.parse(s));
        expect(persisted.at(-1)).toEqual(e);
        received.push(structuredClone(e));
        e.screenBefore = 'sink mutation must not leak';
      },
      onResult: async r => { terminalCount++; expect(r.events).toEqual(received); },
      decide: async input => {
        await access(input.screenshot.uri); // Model always receives the local image.
        return input.previousActions.length ? { type: 'click', elementId: 'create-workspace' }
          : { type: 'type', elementId: 'workspace-name', value: 'Demo' };
      } });
    expect(result.events).toEqual(received); expect(terminalCount).toBe(1);
    expect(result.stepCount).toBe(2); expect(result.goalVerified).toBe(true);
    expect(result.events[1]?.pointer).toBeDefined();
    for (const event of received) expect(event).toMatchObject({ experimentId: 'exp_trace', protocolId: 'proto_trace', batchId: 'batch_trace', scenarioId: 'scn_first_time', executionStatus: 'executed', validationFeedback: [] });
  } finally { await fixture.close(); await rm(dir, { recursive: true, force: true }); }
}, 15000);

it('preserves the event and terminal result when the event sink fails', async () => {
  const fixture = await startFixture(); const dir = await mkdtemp(join(tmpdir(), 'ghostloop-sink-'));
  let count = 0;
  try {
    const result = await runOne({ url: fixture.url, outputDir: dir, signal: new AbortController().signal,
      provenance: 'mock-decisions', decide: async () => ({ type: 'type', elementId: 'workspace-name', value: 'Demo' }),
      onEvent: async () => { count++; throw new Error('sink unavailable'); } });
    expect(count).toBe(1); expect(result.outcome).toBe('browser_error'); expect(result.events).toHaveLength(1);
    expect(JSON.parse(await readFile(join(dir, result.runId, 'run.json'), 'utf8'))).toEqual(result);
    expect(JSON.parse(await readFile(join(dir, result.runId, 'metadata.json'), 'utf8')).sinkError).toBe('sink unavailable');
  } finally { await fixture.close(); await rm(dir, { recursive: true, force: true }); }
}, 15000);

it('records executed actions even when the after-screenshot cannot be published', async () => {
  const fixture = await startFixture(); const dir = await mkdtemp(join(tmpdir(), 'ghostloop-partial-'));
  let images = 0;
  try {
    const result = await runOne({ url: fixture.url, outputDir: dir, signal: new AbortController().signal,
      provenance: 'mock-decisions', decide: async () => ({ type: 'type', elementId: 'workspace-name', value: 'Demo' }),
      publishScreenshot: async image => { if (++images === 2) throw new Error('artifact service unavailable'); return image; } });
    expect(result.outcome).toBe('browser_error'); expect(result.stepCount).toBe(1);
    expect(result.events[0]).toMatchObject({ seq: 0, executionStatus: 'executed', result: 'observation_error', screenAfter: 'unknown', error: 'artifact service unavailable' });
    expect(result.events[0]?.screenshotBefore).toBeDefined();
    expect(result.events[0]?.screenshot).toBeUndefined();
  } finally { await fixture.close(); await rm(dir, { recursive: true, force: true }); }
}, 15000);
