import { createServer } from 'vite';
import { config } from 'dotenv';
import { mkdir, readFile, writeFile, appendFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newId, type BatchResult, type MutationPatch } from '@ghostloop/contracts';
import { createCandidateAdapter, checkGoal } from '../../../packages/prototype-adapter/src';
import { InMemoryStore } from '../../optimizer/src/store';
import { createIntegratedSimulationAdapter } from './integration';
import { controlledScenarios } from './scenarios';
import { exportReplay } from './replay';

const mock = process.argv.includes('--mock');
const provenance = mock ? 'mock-decisions' as const : 'live-bitdeer' as const;
const root = fileURLToPath(new URL('../../../', import.meta.url));
config({ path: resolve(root, '.env') });
const integrationId = newId('exp');
const out = resolve(root, 'workers/simulator/artifacts', integrationId);
await mkdir(out, { recursive: true });
process.env.GHOSTLOOP_RUNS_DIR = resolve(out, 'state');
process.env.GHOSTLOOP_DESIGNS_DIR = resolve(out, 'designs');
await mkdir(resolve(out, 'designs/versions'), { recursive: true });
await copyFile(resolve(root, 'designs/versions/ver_baseline.json'), resolve(out, 'designs/versions/ver_baseline.json'));
const originalBaseline = await readFile(resolve(root, 'designs/versions/ver_baseline.json'));
const abort = new AbortController(); const cancel = () => abort.abort();
process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
const deadline = setTimeout(cancel, 600_000);
const server = await createServer({ root: resolve(root, 'apps/prototype'), configFile: resolve(root, 'apps/prototype/vite.config.ts'),
  logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } });
const batches: BatchResult[] = [];
try {
  await server.listen();
  const baseUrl = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}`;
  const candidates = createCandidateAdapter({ baseUrl, designsDir: process.env.GHOSTLOOP_DESIGNS_DIR });
  const patch: MutationPatch = { schemaVersion: '1.0.0', id: newId('pat'), experimentId: integrationId, round: 1,
    sourceVersionId: 'ver_baseline', targetElementId: 'plan.free.cta', op: 'set_label', value: 'Continue with Free plan',
    observationIds: ['obs_integration_smoke'], rationale: 'Local integration smoke test of a label-only candidate, not a measured optimization.', risk: 'review_required', state: 'approved' };
  const candidate = await candidates.createCandidate('ver_baseline', [patch]);
  await writeFile(resolve(out, 'candidate.json'), JSON.stringify({ candidate, patch }, null, 2));
  const store = new InMemoryStore();
  const scenarios = controlledScenarios().filter(s => ['scn_cost_conscious', 'scn_low_persistence'].includes(s.id));
  const protocolId = newId('proto');
  let used = 0;
  for (const versionId of ['ver_baseline', candidate.versionId] as const) {
    if (abort.signal.aborted) break;
    const adapter = createIntegratedSimulationAdapter({ outputDir: out, provenance, maxInferenceCalls: 40 - used,
      createDecider: mock ? () => async (input, controls) => {
        const desired: Record<string, string> = { 'signup.name': 'Test User', 'signup.email': 'test@example.com', 'signup.password': 'Demo-only-Pass123!', 'workspace.name': 'Demo', 'invite.email': 'teammate@example.com' };
        for (const c of controls) {
          if (c.allowedActions.includes('type') && desired[c.elementId] && (c.inputType === 'password'
            ? !input.previousActions.some(a => a.elementId === c.elementId && a.type === 'type') : c.value !== desired[c.elementId]))
            return { type: 'type', elementId: c.elementId, value: desired[c.elementId] };
          if (c.elementId === 'signup.consent' && !c.checked) return { type: 'click', elementId: c.elementId };
        }
        const button = controls.find(c => ['signup.submit', 'workspace.continue', 'plan.free.cta', 'invite.send'].includes(c.elementId));
        return button ? { type: 'click', elementId: button.elementId } : { type: 'stop' };
      } : undefined,
      maxWallClockMs: 240_000, goalAdapter: { checkGoal: runId => checkGoal(runId, { baseUrl }) } }, store);
    const batch = await adapter.runBatch({ batchId: newId('batch'), experimentId: integrationId, protocolId,
      versionId, versionUrl: baseUrl, scenarios, runsPerBatch: 2, maxActionsPerRun: 16, maxConcurrency: 1,
      task: 'Create an account, create exactly one workspace on the Free plan, and send a valid invitation to one teammate without starting a paid trial.',
      hiddenGoalRef: 'trusted-prototype-checker' }, event => {
        // D's reference store is the real sink; this journal makes delivery reviewable on disk.
        return appendFile(resolve(out, 'sink-events.jsonl'), JSON.stringify(event) + '\n');
      }, abort.signal);
    batches.push(batch); used += batch.usage.inferenceCalls;
    for (const run of batch.runs) {
      const stored = await store.listActions(run.runId);
      if (JSON.stringify(stored) !== JSON.stringify(run.events)) throw new Error('D store replay differs from returned trace');
    }
    await writeFile(resolve(out, 'integration.json'), JSON.stringify({ provenance, store: 'D InMemoryStore (reference store, not deployed database)',
      candidateVersion: candidate.versionId, batches, inferenceCalls: used, eventStoreVerified: true }, null, 2));
    if (batch.cancelled) break;
  }
  const runs = batches.flatMap(batch => batch.runs.map(run => ({ run, batch })));
  const success = runs.find(({ run }) => run.goalVerified);
  const nonSuccess = runs.find(({ run }) => !run.goalVerified && run.behaviorallyValid && run.events.some(e => e.decisionSource === 'model'));
  if (!success || !nonSuccess || batches.length !== 2 || batches.some(b => b.cancelled))
    throw new Error('Incomplete live integration; evidence saved but not exported as a completed handoff');
  const fixtureRoot = mock ? resolve(out, 'mock-replays') : resolve(root, 'packages/contracts/replay-fixtures', integrationId);
  await mkdir(fixtureRoot, { recursive: true });
  for (const [label, entry] of [['success', success], ['non-success', nonSuccess]] as const)
    await exportReplay(resolve(out, entry.batch.batchId, entry.run.runId), resolve(fixtureRoot, label));
  const summary = { provenance, experimentId: integrationId, candidateVersion: candidate.versionId,
    patch: { targetElementId: patch.targetElementId, op: patch.op, value: patch.value },
    eventStore: 'D InMemoryStore reference implementation', eventStoreVerified: true,
    runs: runs.map(({ run }) => ({ runId: run.runId, versionId: run.versionId, scenarioId: run.scenarioId, outcome: run.outcome, stepCount: run.stepCount })),
    fixtures: ['success/run.json', 'non-success/run.json'], inferenceCalls: used,
    caveat: 'Low-persistence stop is a controlled scenario rule. This smoke test does not demonstrate an A/B improvement.' };
  await writeFile(resolve(fixtureRoot, 'integration.json'), JSON.stringify(summary, null, 2));
  if (!(await readFile(resolve(root, 'designs/versions/ver_baseline.json'))).equals(originalBaseline)) throw new Error('Baseline source changed');
  console.log(`${provenance} handoff exported: ${fixtureRoot}`);
} finally {
  clearTimeout(deadline); process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); await server.close();
}
