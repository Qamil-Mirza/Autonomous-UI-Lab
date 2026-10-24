import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { GoalCheckResult } from '@ghostloop/contracts';
import { prototypeIntegration } from './prototype';
import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import { startFixture } from './fixture';
import { runPractice } from './run';
import { bitdeerDecider, type Decider } from './bitdeer';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
const { values } = parseArgs({ options: {
  mock: { type: 'boolean', default: false }, headed: { type: 'boolean', default: false },
  'max-actions': { type: 'string' },
  'prototype-url': { type: 'string' }, 'version': { type: 'string', default: 'ver_baseline' },
  'goal-adapter': { type: 'string' },
} });
const abort = new AbortController();
const cancel = () => abort.abort();
process.once('SIGINT', cancel);
process.once('SIGTERM', cancel);
const timer = setTimeout(cancel, 240_000);
const mock: Decider = async input => input.previousActions.length === 0
  ? { type: 'type', elementId: 'workspace-name', value: 'Demo' }
  : { type: 'click', elementId: 'create-workspace' };
try {
  const decide = values.mock ? mock : bitdeerDecider();
  if (values['prototype-url'] && values.mock) throw new Error('--mock only supports the practice page');
  let prototype;
  if (values['prototype-url']) {
    if (!values['goal-adapter']) throw new Error("--prototype-url requires --goal-adapter pointing to C's trusted module exporting checkGoal(runId)");
    const module = await import(pathToFileURL(resolve(values['goal-adapter'])).href);
    if (typeof module.checkGoal !== 'function') throw new Error('Goal adapter must export checkGoal(runId)');
    prototype = prototypeIntegration(values['prototype-url'], values.version!, {
      checkGoal: async runId => GoalCheckResult.parse(await module.checkGoal(runId)),
    });
  }
  const fixture = values['prototype-url'] ? { url: values['prototype-url'], close: async () => {} } : await startFixture();
  try {
    console.log(`${values.mock ? 'MOCK decisions, real browser' : 'LIVE Bitdeer decisions'} · ${fixture.url}`);
    const result = await runPractice({ url: fixture.url, outputDir: fileURLToPath(new URL('../artifacts/', import.meta.url)),
      decide, signal: abort.signal, prototype, maxActions: values['max-actions'] ? Number(values['max-actions']) : undefined, headed: values.headed,
      provenance: values.mock ? 'mock-decisions' : 'live-bitdeer' });
    if (!result.goalVerified) process.exitCode = 1;
  } finally { await fixture.close(); }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Simulator failed');
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  process.removeListener('SIGINT', cancel);
  process.removeListener('SIGTERM', cancel);
}
