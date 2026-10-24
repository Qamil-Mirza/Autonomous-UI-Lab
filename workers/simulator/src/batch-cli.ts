import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import { GoalCheckResult } from '@ghostloop/contracts';
import { createSimulationAdapter } from './batch';
import { controlledScenarios } from './scenarios';
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
const { values } = parseArgs({ options: {
  'prototype-url': { type: 'string', default: 'http://127.0.0.1:5173' },
  version: { type: 'string', default: 'ver_baseline' },
  'goal-adapter': { type: 'string', default: 'packages/prototype-adapter/src/index.ts' },
  'runs-per-scenario': { type: 'string', default: '1' }, concurrency: { type: 'string', default: '2' },
  'max-actions': { type: 'string', default: '16' }, 'max-calls': { type: 'string', default: '120' },
  'max-ms': { type: 'string', default: '900000' }, protocol: { type: 'string', default: 'proto_controlled_v1' },
  headed: { type: 'boolean', default: false },
} });
const abort = new AbortController();
const cancel = () => abort.abort();
process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
try {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const module = await import(pathToFileURL(resolve(root, values['goal-adapter']!)).href);
  if (typeof module.checkGoal !== 'function') throw new Error('Goal adapter must export checkGoal');
  const scenarios = controlledScenarios(Number(values['runs-per-scenario']));
  const batchId = `batch_${randomUUID()}` as const;
  const adapter = createSimulationAdapter({ outputDir: resolve(root, 'workers/simulator/artifacts/batches'),
    provenance: 'live-bitdeer', headed: values.headed, maxInferenceCalls: Number(values['max-calls']), maxWallClockMs: Number(values['max-ms']),
    goalAdapter: { checkGoal: async runId => GoalCheckResult.parse(await module.checkGoal(runId, { baseUrl: values['prototype-url'] })) } });
  console.log(`LIVE Bitdeer batch: ${scenarios.reduce((n, s) => n + s.runs, 0)} sessions, concurrency ${values.concurrency}`);
  const result = await adapter.runBatch({ batchId, experimentId: 'exp_controlled', protocolId: values.protocol as `proto_${string}`,
    versionId: values.version as `ver_${string}`, versionUrl: values['prototype-url']!,
    task: 'Create an account, create exactly one workspace on the Free plan, and send a valid invitation to one teammate without starting a paid trial.',
    scenarios, runsPerBatch: scenarios.reduce((n, s) => n + s.runs, 0), maxActionsPerRun: Number(values['max-actions']),
    maxConcurrency: Number(values.concurrency), hiddenGoalRef: 'trusted-prototype-checker' }, () => {}, abort.signal);
  console.log(`${result.runs.length}/${result.plannedRuns} sessions recorded; ${result.runs.filter(r => r.goalVerified).length} verified goals; ${result.usage.inferenceCalls} model calls.`);
  console.log(`Batch: ${resolve(root, 'workers/simulator/artifacts/batches', batchId, 'batch.json')}`);
  if (result.cancelled) process.exitCode = 1;
} catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
