import { it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFile, rm } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

// Vitest and tsx transform callbacks differently. Exercise the user's actual CLI.
it('runs browser observations through the tsx CLI without injected helper errors', async () => {
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  const tsx = createRequire(import.meta.url).resolve('tsx/cli');
  const { stdout } = await promisify(execFile)(process.execPath, [tsx, 'src/cli.ts', '--mock'], {
    cwd, env: process.env, timeout: 30000,
  });
  const trace = stdout.match(/Trace: (.+run\.json)/)?.[1];
  expect(trace).toBeDefined();
  expect(trace!.startsWith(resolve(cwd, 'artifacts') + sep)).toBe(true);
  try {
    const run = JSON.parse(await readFile(trace!, 'utf8'));
    expect(run.outcome).toBe('goal');
    expect(run.stepCount).toBe(2);
    const observation = JSON.parse(await readFile(`${run.screenshots[0].uri}.observation.json`, 'utf8'));
    expect(observation.controls.map((c: { elementId: string }) => c.elementId)).toContain('workspace-name');
  } finally { await rm(dirname(trace!), { recursive: true, force: true }); }
}, 35000);
