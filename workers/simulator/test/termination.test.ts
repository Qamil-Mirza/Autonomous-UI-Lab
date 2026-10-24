import { createServer } from 'node:http';
import { it, expect } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GoalCheckResult } from '@ghostloop/contracts';
import type { Page } from 'playwright';
import { runOne, type RunOptions } from '../src/run';
import { startFixture } from '../src/fixture';
import { REQUIRED_GOAL_CHECKS } from '../src/goal';

async function setup(test: (base: RunOptions, dir: string) => Promise<void>) {
  const fixture = await startFixture(); const dir = await mkdtemp(join(tmpdir(), 'ghostloop-termination-'));
  try { await test({ url: fixture.url, outputDir: dir, signal: new AbortController().signal,
    provenance: 'mock-decisions', decide: async () => ({ type: 'stop' }) }, dir); }
  finally { await fixture.close(); await rm(dir, { recursive: true, force: true }); }
}

it('cancels a noncooperative model, closes its context, and records one terminal result', async () => setup(async (base, dir) => {
  const controller = new AbortController(); let page: Page | undefined; let terminals = 0;
  const result = await runOne({ ...base, signal: controller.signal,
    checkGoal: async p => { page = p; return false; },
    decide: async () => { setTimeout(() => controller.abort(), 10); return new Promise(() => {}); },
    onResult: () => { terminals++; } });
  expect(result.outcome).toBe('user_cancelled'); expect(terminals).toBe(1);
  expect(page!.isClosed()).toBe(true); expect(page!.context().browser()?.isConnected()).not.toBe(true);
  expect(JSON.parse(await readFile(join(dir, result.runId, 'run.json'), 'utf8'))).toEqual(result);
  expect(JSON.parse(await readFile(join(dir, result.runId, 'metadata.json'), 'utf8')).usage.inferenceCalls).toBe(1);
}), 15000);

it('enforces a deadline without relying on the CLI timer', async () => setup(async (base, dir) => {
  const result = await runOne({ ...base, maxWallClockMs: 1200, decide: async () => new Promise(() => {}) });
  expect(result.outcome).toBe('user_cancelled');
  expect(JSON.parse(await readFile(join(dir, result.runId, 'metadata.json'), 'utf8')).stopReason).toBe('wall_clock_limit');
}), 15000);

it('reports usage and honors D’s stop before another action', async () => setup(async (base, dir) => {
  let calls = 0; const usage: number[] = [];
  const result = await runOne({ ...base, decide: async () => { calls++; return { type: 'stop' }; },
    onUsage: u => { usage.push(u.inferenceCalls); return u.inferenceCalls < 1; } });
  expect(calls).toBe(1); expect(result.events).toHaveLength(0); expect(result.outcome).toBe('user_cancelled');
  expect(usage).toContain(1);
  const metadata = JSON.parse(await readFile(join(dir, result.runId, 'metadata.json'), 'utf8'));
  expect(metadata.stopReason).toBe('global_usage_limit'); expect(metadata.usage.inferenceUsd).toBe(0);
  expect(metadata.usage.wallClockMs).toBeGreaterThan(0);
}), 15000);

it('bounds result delivery and records cleanup errors without dropping the terminal run', async () => setup(async (base, dir) => {
  let cleanup = 0;
  const result = await runOne({ ...base, hookTimeoutMs: 100,
    prototype: { versionId: 'ver_test', url: () => base.url,
      initialize: async () => [{ elementId: 'workspace-name', screen: 'workspace-form', role: 'textbox', label: 'Name' }],
      allowRequest: url => url === base.url,
      checkGoal: async runId => GoalCheckResult.parse({ runId, achieved: false, at: new Date().toISOString(), checks: REQUIRED_GOAL_CHECKS.map(name => ({ name, passed: false, detail: 'test' })) }),
      cleanup: async () => { cleanup++; throw new Error('cleanup unavailable'); } },
    onResult: async () => new Promise(() => {}) });
  expect(cleanup).toBe(1);
  const metadata = JSON.parse(await readFile(join(dir, result.runId, 'metadata.json'), 'utf8'));
  expect(metadata.cleanupError).toBe('cleanup unavailable'); expect(metadata.sinkError).toContain('timed out');
  expect(JSON.parse(await readFile(join(dir, result.runId, 'run.json'), 'utf8'))).toEqual(result);
}), 15000);

it('uses flow_blocked for a rendered page with no controls and closes it', async () => setup(async base => {
  const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<main data-screen="blocked">No available actions</main>'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  let page: Page | undefined;
  try {
    const port = (server.address() as { port: number }).port;
    const result = await runOne({ ...base, url: `http://127.0.0.1:${port}/`,
      checkGoal: async p => { page = p; return false; },
      decide: async () => { throw new Error('Must not ask model on an empty screen'); } });
    expect(result.outcome).toBe('flow_blocked'); expect(result.events).toHaveLength(0);
    expect(page!.isClosed()).toBe(true);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}), 15000);
