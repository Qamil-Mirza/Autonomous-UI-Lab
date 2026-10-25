import { it, expect } from 'vitest';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { AgentRunResult } from '@ghostloop/contracts';
import { exportReplay } from '../src/replay';
const root = fileURLToPath(new URL('../../../packages/contracts/replay-fixtures/recorded-2026-10-24/', import.meta.url));
it.each(['success', 'non-success'])('validates the portable %s live fixture and every screenshot checksum', async name => {
  const dir = join(root, name);
  const run = AgentRunResult.parse(JSON.parse(await readFile(join(dir, 'run.json'), 'utf8')));
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  expect(manifest.provenance).toBe('live-bitdeer'); expect(manifest.sourceRunId).toBe(run.runId);
  expect(run.goalVerified).toBe(name === 'success');
  expect(run.events.map(e => e.seq)).toEqual(run.events.map((_, i) => i));
  const events = (await readFile(join(dir, 'events.jsonl'), 'utf8')).trim().split('\n').map(s => JSON.parse(s));
  expect(events).toEqual(run.events);
  for (const ref of run.screenshots) {
    expect(ref.uri).toMatch(/^frame-\d+\.png$/);
    const image = await readFile(join(dir, ref.uri));
    expect(createHash('sha256').update(image).digest('hex')).toBe(manifest.screenshots.find((s: {uri:string}) => s.uri === ref.uri).sha256);
  }
});
it('exports only allowlisted provenance and refuses to overwrite evidence or copy outside screenshots', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ghostloop-export-'));
  try {
    const source = join(dir, 'source'); await cp(join(root, 'success'), source, { recursive: true });
    await writeFile(join(source, 'metadata.json'), JSON.stringify({ provenance: 'mock-decisions', model: null, apiKey: 'DO_NOT_EXPORT' }));
    const exported = await exportReplay(source, join(dir, 'export'));
    expect(exported.manifest.provenance).toBe('mock-decisions');
    expect(JSON.stringify(exported.manifest)).not.toContain('DO_NOT_EXPORT');
    await expect(exportReplay(source, join(dir, 'export'))).rejects.toThrow();
    const raw = JSON.parse(await readFile(join(source, 'run.json'), 'utf8'));
    await cp(join(source, 'frame-000.png'), join(dir, 'outside.png'));
    raw.screenshots[0].uri = '../outside.png'; await writeFile(join(source, 'run.json'), JSON.stringify(raw));
    await expect(exportReplay(source, join(dir, 'unsafe'))).rejects.toThrow('outside');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
