import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { AgentRunResult, type ScreenshotRef } from '@ghostloop/contracts';

/** Portable replay package; preserves actual actions/outcome and never relabels mocks as live. */
export async function exportReplay(sourceDir: string, destinationDir: string) {
  const source = await realpath(sourceDir);
  const original = AgentRunResult.parse(JSON.parse(await readFile(resolve(source, 'run.json'), 'utf8')));
  const metadata = JSON.parse(await readFile(resolve(source, 'metadata.json'), 'utf8'));
  if (!['live-bitdeer', 'mock-decisions'].includes(metadata.provenance)) throw new Error('Missing or unknown replay provenance');
  original.events.forEach((e, index) => {
    if (e.seq !== index || e.versionId !== original.versionId) throw new Error('Replay events must be ordered and match the run version');
  });
  const refs = [...original.screenshots, ...original.events.flatMap(e => [e.screenshotBefore, e.screenshot].filter((s): s is ScreenshotRef => !!s))];
  const mapped = new Map<string, ScreenshotRef>();
  const files: { name: string; bytes: Buffer; sha256: string }[] = [];
  for (const ref of refs) {
    if (mapped.has(ref.uri)) continue;
    const path = await realpath(resolve(source, ref.uri));
    const within = relative(source, path);
    if (within.startsWith('..') || isAbsolute(within)) throw new Error('Replay screenshot is outside the source run');
    const bytes = await readFile(path);
    if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
        bytes.readUInt32BE(16) !== ref.width || bytes.readUInt32BE(20) !== ref.height)
      throw new Error('Screenshot is not a PNG with the recorded dimensions');
    const name = `frame-${String(files.length).padStart(3, '0')}.png`;
    mapped.set(ref.uri, { ...ref, uri: name });
    files.push({ name, bytes, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const run = AgentRunResult.parse({ ...original, screenshots: original.screenshots.map(s => mapped.get(s.uri)!),
    events: original.events.map(e => ({ ...e, screenshotBefore: e.screenshotBefore ? mapped.get(e.screenshotBefore.uri) : undefined,
      screenshot: e.screenshot ? mapped.get(e.screenshot.uri) : undefined })) });
  await mkdir(destinationDir, { recursive: false }); // Never silently replace existing evidence.
  for (const file of files) await writeFile(resolve(destinationDir, file.name), file.bytes);
  await writeFile(resolve(destinationDir, 'run.json'), JSON.stringify(run, null, 2));
  await writeFile(resolve(destinationDir, 'events.jsonl'), run.events.map(e => JSON.stringify(e)).join('\n') + (run.events.length ? '\n' : ''));
  const manifest = { schemaVersion: '1.0.0', provenance: metadata.provenance, model: metadata.model ?? null,
    sourceRunId: run.runId, versionId: run.versionId, outcome: run.outcome, goalVerified: run.goalVerified,
    decisionCalls: metadata.decisionCalls, controlledActions: run.events.filter(e => e.decisionSource === 'scenario').length,
    note: 'Recorded run, not a synthetic fixture. Controlled scenario interventions are labeled in events. A single run does not establish A/B improvement.',
    screenshots: files.map(({ name, sha256 }) => ({ uri: name, sha256 })) };
  await writeFile(resolve(destinationDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { run, manifest };
}
