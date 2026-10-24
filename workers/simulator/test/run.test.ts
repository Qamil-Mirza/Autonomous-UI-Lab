import { it, expect } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runOne, type RunOptions } from '../src/run';
import { startFixture } from '../src/fixture';

async function withRun(test: (base: RunOptions, dir: string) => Promise<void>) {
  const fixture = await startFixture();
  const dir = await mkdtemp(join(tmpdir(), 'ghostloop-loop-'));
  try { await test({ url: fixture.url, outputDir: dir, decide: async () => ({ type: 'stop' }),
    signal: new AbortController().signal, provenance: 'mock-decisions' }, dir); }
  finally { await fixture.close(); await rm(dir, { recursive: true, force: true }); }
}

it('passes configured task/scenario and observed history without checker data or route hints', async () => withRun(async (base, dir) => {
  let checks = 0;
  const result = await runOne({ ...base, task: 'Create a workspace named Research.',
    scenario: { id: 'scn_research', name: 'Research', description: 'A careful visitor', inputs: { workspaceName: 'Research' }, runs: 1 },
    experimentId: 'exp_research', protocolId: 'proto_research', batchId: 'batch_research',
    checkGoal: async page => {
      checks++;
      return page.evaluate(() => JSON.parse(sessionStorage.getItem('practice-workspaces') || '[]').some((w: {name:string}) => w.name === 'Research'));
    },
    decide: async input => {
      expect(input.task).toBe('Create a workspace named Research.');
      expect(input.scenario).toEqual({ description: 'A careful visitor', inputs: { workspaceName: 'Research' } });
      expect(input.remainingActions).toBe(6 - input.previousActions.length);
      expect(input.history).toHaveLength(input.previousActions.length);
      const serialized = JSON.stringify(input);
      for (const secret of ['practice-workspaces', 'checkGoal', 'goalEvidence', 'allowedPaths', 'hiddenGoalRef']) expect(serialized).not.toContain(secret);
      if (input.previousActions.length === 1) {
        expect(input.history?.[0]).toMatchObject({ seq: 0, result: 'ok', action: { value: 'Research' } });
        return { type: 'click', elementId: 'create-workspace' };
      }
      return { type: 'type', elementId: 'workspace-name', value: input.scenario.inputs.workspaceName };
    } });
  expect(result).toMatchObject({ outcome: 'goal', stepCount: 2, scenarioId: 'scn_research', experimentId: 'exp_research' });
  expect(checks).toBe(4); // Initial, after each of two actions, terminal.
  const inputs = (await readFile(join(dir, result.runId, 'model-inputs.jsonl'), 'utf8')).trim().split('\n');
  expect(inputs).toHaveLength(2);
  const execution = (await readFile(join(dir, result.runId, 'execution.jsonl'), 'utf8')).trim().split('\n').map(s => JSON.parse(s));
  expect(execution.map(e => e.status)).toEqual(['started', 'executed', 'started', 'executed']);
}), 15000);

it('checks at termination after a model fault without converting it to a flow blockage', async () => withRun(async (base, dir) => {
  let checks = 0;
  const result = await runOne({ ...base, checkGoal: async () => { checks++; return false; },
    decide: async () => { throw new Error('transport failed permanently'); } });
  expect(result.outcome).toBe('model_error');
  expect(result.events).toEqual([]);
  expect(checks).toBe(2);
  expect((await readFile(join(dir, result.runId, 'goal-checks.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(2);
}), 15000);

it('stops immediately when the trusted checker reports an initially achieved goal', async () => withRun(async base => {
  let decisions = 0;
  const result = await runOne({ ...base, checkGoal: async () => true,
    decide: async () => { decisions++; return { type: 'stop' }; } });
  expect(result.goalVerified).toBe(true); expect(result.stepCount).toBe(0); expect(decisions).toBe(0);
}), 15000);

it('does not report success if the terminal checker fails', async () => withRun(async base => {
  let checks = 0;
  const result = await runOne({ ...base, checkGoal: async () => {
    if (++checks === 1) return true;
    throw new Error('checker unavailable');
  } });
  expect(result.outcome).toBe('browser_error'); expect(result.goalVerified).toBe(false);
}), 15000);
