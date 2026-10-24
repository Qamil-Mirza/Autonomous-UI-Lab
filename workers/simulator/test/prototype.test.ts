import { it, expect } from 'vitest';
import { GoalCheckResult } from '@ghostloop/contracts';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prototypeIntegration, loadRegistry, prototypeUrl } from '../src/prototype';
import { runPractice } from '../src/run';

it('uses run-scoped APIs, test IDs, trusted checks, and CSS pixels on Retina', async () => {
  const calls: string[] = [];
  const states = new Map<string, boolean>();
  const server = createServer(async (req, res) => {
    calls.push(`${req.method} ${req.url}`);
    const u = new URL(req.url!, 'http://localhost');
    const match = u.pathname.match(/^\/api\/runs\/([^/]+)(.*)$/);
    res.setHeader('Content-Type', 'application/json');
    if (match) {
      const id = match[1]!;
      if (req.method === 'POST' && match[2] === '/init') states.set(id, false);
      else if (req.method === 'DELETE') states.delete(id);
      else if (req.method === 'POST' && match[2] === '/state') states.set(id, true);
      res.end(JSON.stringify({ achieved: states.get(id) ?? false }));
      return;
    }
    if (u.pathname.startsWith('/designs/versions/')) {
      res.end(JSON.stringify({ versionId: 'ver_baseline', elements: [
        { id: 'signup.name', screen: 'signup', role: 'textbox', label: 'Full name', protected: true, supportedOps: [] },
        { id: 'signup.consent', screen: 'signup', role: 'checkbox', label: 'Consent' },
        { id: 'signup.submit', screen: 'signup', role: 'button', label: 'Create account' },
        { id: 'decor.sparkle', screen: 'signup', role: 'text', label: '*' },
      ] })); return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><input aria-label="Full name" data-testid="signup.name"><label><input type="checkbox" data-testid="signup.consent">Consent</label><span data-testid="decor.sparkle">*</span><button data-testid="signup.submit">Create account</button><div role="alert"></div>
<script>document.querySelector('button').onclick=async()=>{if(!document.querySelector('[type=checkbox]').checked){document.querySelector('[role=alert]').textContent='Consent required';return;} await fetch('/api/runs/'+new URLSearchParams(location.search).get('run')+'/state',{method:'POST'});document.querySelector('button').disabled=true;}</script>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const dir = await mkdtemp(join(tmpdir(), 'ghostloop-prototype-'));
  try {
    const adapter = { checkGoal: async (runId: string) => {
      const response = await fetch(`${base}/api/runs/${runId}/state`);
      const state = await response.json() as { achieved: boolean };
      return GoalCheckResult.parse({ runId, achieved: state.achieved, checks: [{ name: 'Stub server state', passed: state.achieved, detail: 'Local test stub' }], at: new Date().toISOString() });
    } };
    const integration = prototypeIntegration(base, 'ver_baseline', adapter);
    expect(prototypeUrl(base, 'ver_baseline', 'run_example')).toBe(`${base}/v/ver_baseline/signup?run=run_example`);
    expect(integration.allowRequest(`${base}/v/ver_baseline/confirm?run=run_other`, true, 'run_example')).toBe(false);
    expect(integration.allowRequest(`${base}/api/runs/run_other/state`, false, 'run_example')).toBe(false);
    expect(integration.allowRequest(`${base}/v/ver_other/signup?run=run_example`, true, 'run_example')).toBe(false);
    const registry = await loadRegistry(base, 'ver_baseline', new AbortController().signal);
    expect(registry.elements[0]).not.toHaveProperty('protected');
    expect(registry.elements[0]).not.toHaveProperty('supportedOps');
    const result = await runPractice({ url: base, prototype: integration, outputDir: dir, deviceScaleFactor: 2,
      signal: new AbortController().signal, provenance: 'mock-decisions', decide: async (input, controls) => {
        expect(controls.map(c => c.elementId)).not.toContain('decor.sparkle');
        expect(JSON.stringify(input)).not.toContain('protected');
        const actions = [
          { type: 'type', elementId: 'signup.name', value: 'Example User' },
          { type: 'click', elementId: 'signup.consent' },
          { type: 'click', elementId: 'signup.submit' },
        ];
        return actions[input.previousActions.length] ?? { type: 'stop' };
      } });
    expect(result.goalVerified).toBe(true);
    expect(result.events).toHaveLength(3);
    expect(result.events.every(e => e.versionId === 'ver_baseline')).toBe(true);
    expect(calls).toContain(`POST /api/runs/${result.runId}/init`);
    expect(calls).toContain(`GET /v/ver_baseline/signup?run=${result.runId}`);
    expect(calls).toContain(`DELETE /api/runs/${result.runId}`);
    expect(states.size).toBe(0);
    const png = await readFile(result.screenshots[0]!.uri);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1280, 800]);
    expect(result.events[2]!.viewport).toEqual({ width: 1280, height: 800 });
    const runDir = join(dir, (await readdir(dir))[0]!);
    expect(JSON.parse(await readFile(join(runDir, 'goal-check.json'), 'utf8')).runId).toBe(result.runId);
    const wrongRun = prototypeIntegration(base, 'ver_baseline', { checkGoal: async () => ({ runId: 'run_wrong', achieved: true, checks: [{ name: 'check', passed: true, detail: 'Wrong run test' }], at: new Date().toISOString() }) });
    await expect(wrongRun.checkGoal('run_example')).rejects.toThrow('another run');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);
