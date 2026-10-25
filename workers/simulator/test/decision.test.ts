import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PublicAgentInput } from '@ghostloop/contracts';
import { validateDecision, type ObservedControl } from '../src/actions';
import { requestDecision, ModelResponseError } from '../src/decision';
import { bitdeerDecider, retryAfterMs } from '../src/bitdeer';
import { openBrowserSession, observeControls, execute } from '../src/browser';
import { prototypeIntegration } from '../src/prototype';
import { startFixture } from '../src/fixture';
import { runPractice } from '../src/run';

const control: ObservedControl = { elementId: 'name', role: 'textbox', label: 'Name', enabled: true,
  allowedActions: ['type'], bounds: { x: 0, y: 0, width: 100, height: 30 } };
const valid = { type: 'type', elementId: 'name', value: 'Demo' };
const input = { screenshot: { uri: '', width: 1280, height: 800 } } as PublicAgentInput;
const defaults = { input, controls: [control], signal: new AbortController().signal, retryDelayMs: 0, rateLimitDelayMs: 0 };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('strict action validation', () => {
  it('rejects ambiguous IDs, extra fields, invalid types, oversized and unfillable values', () => {
    for (const raw of [null, [], { type: 'evaluate', value: 'alert(1)' }, { ...valid, elementId: 'a"]' },
      { ...valid, value: 1 }, { ...valid, value: 'a'.repeat(2001) }, { ...valid, code: 'alert(1)' }])
      expect(() => validateDecision(raw, [control])).toThrow();
    expect(() => validateDecision(valid, [control, control])).toThrow('exactly one');
    expect(() => validateDecision(valid, [{ ...control, maxLength: 3 }])).toThrow('maximum length');
    expect(() => validateDecision(valid, [{ ...control, inputType: 'number' }])).toThrow('numeric');
    // Application validation remains observable; do not enforce email syntax or required fields here.
    expect(validateDecision({ ...valid, value: 'bad-email' }, [{ ...control, inputType: 'email' }])).toBeDefined();
    expect(validateDecision({ ...valid, value: '' }, [control])).toBeDefined();
  });
  it('allows only exact version/run navigation routes', () => {
    const integration = prototypeIntegration('http://localhost:5173', 'ver_baseline', { checkGoal: async () => { throw new Error('unused'); } });
    const allow = (url: string) => integration.allowRequest(url, true, 'run_a');
    const good = 'http://localhost:5173/v/ver_baseline/workspace?run=run_a';
    expect(allow(good)).toBe(true);
    for (const url of [good.replace('5173', '5174'), good.replace('ver_baseline', 'ver_other'),
      good.replace('workspace', 'extra/workspace'), good.replace('run_a', 'run_b'), `${good}&run=run_b`,
      'javascript:alert(1)', 'data:text/html,hello']) {
      expect(() => validateDecision({ type: 'click', elementId: 'name' },
        [{ ...control, allowedActions: ['click'], navigationUrl: url }], allow)).toThrow();
    }
    expect(validateDecision({ type: 'click', elementId: 'name' },
      [{ ...control, allowedActions: ['click'], navigationUrl: good }], allow)).toBeDefined();
  });
});

describe('bounded decisions', () => {
  it('retries invalid decisions with feedback and returns only the validated answer', async () => {
    const decide = vi.fn().mockResolvedValueOnce({ type: 'click', elementId: 'invented' }).mockResolvedValue(valid);
    const onAttempt = vi.fn();
    expect(await requestDecision({ ...defaults, decide, onAttempt })).toEqual(valid);
    expect(decide).toHaveBeenCalledTimes(2);
    expect(decide.mock.calls[1]?.[3]).toContain('observed control');
    expect(onAttempt.mock.calls.map(c => c[0].status)).toEqual(['rejected', 'accepted']);
  });
  it('exhausts exactly three attempts and does not retry permanent or arbitrary errors', async () => {
    const decide = vi.fn().mockResolvedValue({ type: 'execute-js' });
    await expect(requestDecision({ ...defaults, decide })).rejects.toThrow('Invalid action');
    expect(decide).toHaveBeenCalledTimes(3);
    for (const error of [new ModelResponseError('Bitdeer 402', false), new Error('unexpected bug')]) {
      const permanent = vi.fn().mockRejectedValue(error);
      await expect(requestDecision({ ...defaults, decide: permanent })).rejects.toThrow(error.message);
      expect(permanent).toHaveBeenCalledTimes(1);
    }
  });
  it('requires a reason when asked', async () => {
    const decide = vi.fn().mockResolvedValueOnce({ type: 'type', elementId: 'name', value: 'Demo' }).mockResolvedValue({ ...valid, reason: 'fill the name' });
    const onAttempt = vi.fn();
    expect(await requestDecision({ ...defaults, decide, onAttempt, requireReason: true })).toEqual({ ...valid, reason: 'fill the name' });
    expect(onAttempt.mock.calls[0]![0].feedback).toContain('reason');
    expect(await requestDecision({ ...defaults, decide: vi.fn().mockResolvedValue(valid) })).toEqual(valid);
  });
  it('waits out rate limits without spending attempts, honoring Retry-After', async () => {
    const limited = new ModelResponseError('Bitdeer HTTP 429 (rate limited)', true, { limited: true, retryAfterMs: 5 });
    const decide = vi.fn().mockRejectedValueOnce(limited).mockRejectedValueOnce(limited).mockRejectedValueOnce(limited).mockResolvedValue(valid);
    const onAttempt = vi.fn();
    const started = Date.now();
    expect(await requestDecision({ ...defaults, maxAttempts: 1, decide, onAttempt })).toEqual(valid);
    expect(decide).toHaveBeenCalledTimes(4);
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
    expect(onAttempt.mock.calls.slice(0, 3).every(c => c[0].feedback.includes('waiting 5ms'))).toBe(true);
  });
  it('falls back to ordinary attempts once the rate-limit waits are used up', async () => {
    const decide = vi.fn().mockRejectedValue(new ModelResponseError('Bitdeer HTTP 429 (rate limited)', true, { limited: true }));
    await expect(requestDecision({ ...defaults, maxRateLimitWaits: 2, decide })).rejects.toThrow('429');
    expect(decide).toHaveBeenCalledTimes(2 + 3);
  });
  it('reads Retry-After as seconds or an HTTP date', () => {
    expect(retryAfterMs('3')).toBe(3000);
    expect(retryAfterMs('Sat, 25 Oct 2026 04:00:10 GMT', Date.parse('Sat, 25 Oct 2026 04:00:00 GMT'))).toBe(10000);
    expect(retryAfterMs(null)).toBeUndefined();
    expect(retryAfterMs('soon')).toBeUndefined();
  });
  it('cancels backoff without another request', async () => {
    const controller = new AbortController();
    const decide = vi.fn().mockRejectedValue(new ModelResponseError('timeout', true));
    await expect(requestDecision({ ...defaults, signal: controller.signal, retryDelayMs: 500, decide,
      onAttempt: async () => { controller.abort(); } })).rejects.toThrow();
    expect(decide).toHaveBeenCalledTimes(1);
  });
  it.each([429, 503, 'network', 'timeout', 'malformed', 'missing'] as const)('recovers from %s using the real Bitdeer decider with mocked HTTP', async failure => {
    const dir = await mkdtemp(join(tmpdir(), 'ghostloop-http-'));
    try {
      const uri = join(dir, 'screenshot.png');
      await writeFile(uri, 'test image bytes');
      vi.stubEnv('BITDEER_API_KEY', 'fake-test-key');
      const fetchMock = vi.fn();
      if (failure === 'timeout') {
        vi.stubEnv('BITDEER_TIMEOUT_MS', '10');
        fetchMock.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
        }));
      }
      else if (failure === 'network') fetchMock.mockRejectedValueOnce(new TypeError('network'));
      else fetchMock.mockResolvedValueOnce(typeof failure === 'number' ? new Response('', { status: failure })
        : Response.json({ choices: failure === 'missing' ? [] : [{ message: { content: 'not JSON' } }] }));
      fetchMock.mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify(valid) } }] }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(requestDecision({ ...defaults, input: { ...input, screenshot: { ...input.screenshot, uri } }, decide: bitdeerDecider() })).resolves.toEqual(valid);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('does not retry an actual HTTP 402 response', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ghostloop-http-'));
    try {
      const uri = join(dir, 'screenshot.png'); await writeFile(uri, 'image');
      vi.stubEnv('BITDEER_API_KEY', 'fake-test-key');
      const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 402 })); vi.stubGlobal('fetch', fetchMock);
      await expect(requestDecision({ ...defaults, input: { ...input, screenshot: { ...input.screenshot, uri } }, decide: bitdeerDecider() })).rejects.toThrow('credits');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

it('revalidates the live DOM and blocks unsafe link/form clicks before side effects', async () => {
  const fixture = await startFixture();
  const session = await openBrowserSession({ url: fixture.url, signal: defaults.signal });
  try {
    const { page } = session;
    await page.setContent(`<input data-testid="name" maxlength="3"><input data-testid="email" type="email"><select data-testid="plan"><option value="free">Free</option><option value="other">Other</option><option disabled value="paid">Paid</option></select>
      <a data-testid="js" href="javascript:document.body.dataset.clicked='yes'">JS</a>
      <a data-testid="external" href="https://example.com">External</a>
      <a data-testid="popup" target="_blank" href="${fixture.url}">Popup</a>
      <form action="https://example.com"><button data-testid="submit">Submit</button></form>`);
    await page.evaluate(() => { document.addEventListener('click', () => { document.body.dataset.clicked = 'yes'; }); });
    expect((await observeControls(page)).find(c => c.elementId === 'name')?.maxLength).toBe(3);
    for (const elementId of ['js', 'external', 'popup', 'submit'])
      await expect(execute(page, { type: 'click', elementId })).rejects.toThrow();
    expect(await page.getAttribute('body', 'data-clicked')).toBeNull();
    await expect(execute(page, valid as { type: 'type'; elementId: string; value: string })).rejects.toThrow('maximum length');
    await execute(page, { type: 'select', elementId: 'plan', value: 'other' });
    expect(await page.getByTestId('plan').inputValue()).toBe('other');
    await expect(execute(page, { type: 'select', elementId: 'plan', value: 'paid' })).rejects.toThrow('select option');
    expect(await page.getByTestId('plan').inputValue()).toBe('other');
    await execute(page, { type: 'type', elementId: 'email', value: 'invalid-email' });
    expect(await page.getByTestId('email').inputValue()).toBe('invalid-email');
    await page.getByTestId('email').evaluate(el => (el as HTMLInputElement).disabled = true);
    await expect(execute(page, { type: 'type', elementId: 'email', value: 'new' })).rejects.toThrow();
    expect(await page.getByTestId('email').inputValue()).toBe('invalid-email');
  } finally { await session.close(); await fixture.close(); }
}, 15000);

it('records retries separately and never executes rejected actions', async () => {
  const fixture = await startFixture(); const dir = await mkdtemp(join(tmpdir(), 'ghostloop-retries-'));
  let calls = 0;
  try {
    const result = await runPractice({ url: fixture.url, outputDir: dir, signal: defaults.signal, provenance: 'mock-decisions',
      decide: async input => ++calls === 1 ? { type: 'click', elementId: 'invented' }
        : input.previousActions.length === 0 ? { type: 'type', elementId: 'workspace-name', value: 'Demo' }
        : { type: 'click', elementId: 'create-workspace' } });
    expect(result.outcome).toBe('goal'); expect(result.stepCount).toBe(2);
    const metadata = JSON.parse(await readFile(join(dir, result.runId, 'metadata.json'), 'utf8'));
    expect(metadata.decisionCalls).toBe(3);
    const attempts = (await readFile(join(dir, result.runId, 'decision-attempts.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(attempts.map(a => a.status)).toEqual(['rejected', 'accepted', 'accepted']);
    expect(result.events.map(e => e.seq)).toEqual([0, 1]);
  } finally { await fixture.close(); await rm(dir, { recursive: true, force: true }); }
}, 15000);
