import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { ControlRegistryEntry, ScreenshotRef } from '@ghostloop/contracts';
import type { ObservedControl, Decision } from './actions';
import { bounded } from './lifecycle';
import { validateDecision } from './actions';

const actualPointers = new WeakMap<Page, { x: number; y: number }>();
export const viewport = { width: 1280, height: 800 };
export interface BrowserSession {
  page: Page;
  context: BrowserContext;
  close(): Promise<void>;
}
export interface OpenBrowserOptions {
  url: string;
  signal: AbortSignal;
  headed?: boolean;
  deviceScaleFactor?: number;
  allowRequest?: (url: string, navigation: boolean) => boolean;
}

/** Owns an isolated browser/context and releases it on initialization failure or cancellation. */
export async function openBrowserSession(options: OpenBrowserOptions): Promise<BrowserSession> {
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  const abort = () => { void browser?.close().catch(() => {}); };
  options.signal.addEventListener('abort', abort);
  try {
    options.signal.throwIfAborted();
    browser = await chromium.launch({ timeout: 15000, headless: !options.headed, channel: process.env.SIMULATOR_BROWSER_CHANNEL || undefined });
    options.signal.throwIfAborted();
    context = await browser.newContext({ viewport, deviceScaleFactor: options.deviceScaleFactor ?? 1, serviceWorkers: 'block', acceptDownloads: false });
    await context.route('**/*', route => {
      const request = route.request();
      const allowed = options.allowRequest ? options.allowRequest(request.url(), request.isNavigationRequest()) : request.url() === options.url;
      return allowed ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    await page.exposeBinding('__ghostloopPointer', ({ page: source }, x: number, y: number) => {
      actualPointers.set(source, { x, y });
    });
    await page.addInitScript(() => {
      document.addEventListener('pointerdown', event => {
        if (event.isTrusted) void (window as unknown as { __ghostloopPointer: (x: number, y: number) => Promise<void> })
          .__ghostloopPointer(event.clientX, event.clientY);
      }, true);
    });
    page.setDefaultTimeout(5000);
    options.signal.throwIfAborted();
    const response = await page.goto(options.url, { waitUntil: 'load', timeout: 15000 });
    if (response && !response.ok()) throw new Error(`Prototype navigation HTTP ${response.status()}`);
    if (page.url() !== new URL(options.url).href) throw new Error('Prototype redirected away from the exact requested URL');
    let closing: Promise<void> | undefined;
    return { page, context, close: () => closing ??= (async () => {
      options.signal.removeEventListener('abort', abort);
      try { await bounded(() => context!.close(), 5000, 'Context close'); } finally { await bounded(() => browser!.close(), 5000, 'Browser close'); }
    })() };
  } catch (error) {
    options.signal.removeEventListener('abort', abort);
    await bounded(() => browser?.close(), 5000, 'Failed startup cleanup').catch(() => {});
    throw error;
  }
}

export async function screenId(page: Page): Promise<string> {
  const marker = page.locator('[data-screen]:visible').first();
  if (await marker.count()) return await marker.getAttribute('data-screen') ?? 'unknown';
  return new URL(page.url()).pathname.match(/^\/v\/[^/]+\/([^/]+)$/)?.[1] ?? 'unknown';
}

/** Restricts observations to native controls supported by the action executor. */
export async function observeControls(page: Page, registry?: ControlRegistryEntry[]): Promise<ObservedControl[]> {
  const controls = await page.locator('[data-testid], [data-agent-id]').evaluateAll(elements => {
    const seen = new Set<string>();
    return elements.flatMap(el => {
      const node = el as HTMLInputElement;
      const id = node.getAttribute('data-testid') ?? node.getAttribute('data-agent-id') ?? '';
      if (!/^[a-zA-Z0-9_.-]+$/.test(id) || seen.has(id)) throw new Error('Control IDs must be unique and selector-safe');
      seen.add(id);
      const b = node.getBoundingClientRect();
      if (!b.width || !b.height || node.matches(':disabled') || node.closest('[inert], [aria-disabled="true"], [aria-hidden="true"]')) return [];
      for (let ancestor: Element | null = node; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (style.visibility === 'hidden' || style.visibility === 'collapse' || style.display === 'none' || Number(style.opacity) === 0) return [];
      }
      if (b.top < 0 || b.left < 0 || b.bottom > innerHeight || b.right > innerWidth) return [];
      // Bounds alone are insufficient: a modal or clipped ancestor can cover a target.
      const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      if (!hit || (hit !== node && !node.contains(hit))) return [];
      const tag = node.tagName.toLowerCase();
      const checkable = tag === 'input' && ['checkbox', 'radio'].includes(node.type);
      const writable = !node.readOnly && node.getAttribute('aria-readonly') !== 'true';
      const allowedActions: ('click' | 'type' | 'select')[] = checkable ? ['click']
        : tag === 'select' && !(el as HTMLSelectElement).multiple ? ['select']
        : writable && (tag === 'textarea' || (tag === 'input' && ['text', 'email', 'password', 'search', 'tel', 'url', 'number'].includes(node.type))) ? ['type']
        : tag === 'button' || (tag === 'input' && ['submit', 'button', 'reset'].includes(node.type)) || (tag === 'a' && node.hasAttribute('href')) ? ['click'] : [];
      if (!allowedActions.length) return [];
      const labelledBy = (node.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
        .map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
      const label = labelledBy || node.getAttribute('aria-label') || Array.from(node.labels || []).map(l => l.textContent || '').join(' ')
        || (tag === 'input' && ['submit', 'button', 'reset'].includes(node.type) ? node.value : node.textContent) || node.getAttribute('title') || '';
      const role = checkable ? node.type : allowedActions.includes('type') ? 'textbox' : tag === 'select' ? 'combobox' : tag === 'a' ? 'link' : 'button';
      return [{ elementId: id, role, label: label.replace(/\s+/g, ' ').trim(), enabled: true,
        tagName: tag, inputType: tag === 'input' ? node.type : undefined,
        // Do not copy password values out of the page into observation files/model inputs.
        value: ['input', 'textarea', 'select'].includes(tag) && node.type !== 'password' && !checkable ? node.value : undefined,
        checked: checkable ? node.checked : undefined,
        maxLength: allowedActions.includes('type') && node.maxLength >= 0 ? node.maxLength : undefined,
        navigationUrl: tag === 'a' ? (el as HTMLAnchorElement).href
          : node.form && (node.type === 'submit' || node.type === 'image') ? node.getAttribute('formaction') !== null ? node.formAction : node.form.action : undefined,
        opensNewContext: tag === 'a' ? node.hasAttribute('download') || !['', '_self'].includes((el as HTMLAnchorElement).target || document.querySelector('base')?.target || '')
          : node.form && node.type === 'submit' ? !['', '_self'].includes(node.getAttribute('formtarget') ?? node.form.target) : undefined,
        allowedActions,
        options: tag === 'select' ? Array.from((el as HTMLSelectElement).options).filter(o => !o.disabled && !o.closest('optgroup[disabled]')).map(o => o.value) : undefined,
        bounds: { x: b.x, y: b.y, width: b.width, height: b.height } }];
    });
  });
  if (!registry) return controls;
  const screen = await screenId(page);
  return controls.filter(c => registry.some(r => r.elementId === c.elementId && r.screen === screen));
}

export interface BrowserObservation {
  url: string;
  screenId: string;
  viewport: { width: number; height: number };
  scroll: { x: number; y: number };
  coordinateSpace: 'css-pixels';
  controls: ObservedControl[];
  alerts: string[];
  screenshot: ScreenshotRef;
}

/** Wait for C's rendered registry content, including read-only terminal screens. */
export async function waitForObservationReady(page: Page, registry?: ControlRegistryEntry[]) {
  await page.waitForFunction(entries => {
    const currentScreen = document.querySelector('[data-screen]')?.getAttribute('data-screen')
      ?? location.pathname.match(/^\/v\/[^/]+\/([^/]+)$/)?.[1];
    // Keep this browser callback self-contained: tsx wraps named local functions
    // in a Node-side __name helper that is unavailable in the browser realm.
    return Array.from(document.querySelectorAll('[role="alert"], [data-screen], [data-testid], [data-agent-id]')).some(e => {
      const b = e.getBoundingClientRect();
      if (!b.width || !b.height || getComputedStyle(e).visibility === 'hidden') return false;
      if (e.getAttribute('role') === 'alert') return true;
      if (!entries && e.hasAttribute('data-screen')) return true;
      const id = e.getAttribute('data-testid') ?? e.getAttribute('data-agent-id');
      return id !== null && (!entries || entries.some(r => r.elementId === id && r.screen === currentScreen));
    });
  }, registry, { timeout: 5000 });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

/** Screenshot and whitelisted controls come from the same bounded, stable observation. */
export async function captureObservation(page: Page, options: {
  screenshotPath: string;
  registry?: ControlRegistryEntry[];
  allowUrl?: (url: string) => boolean;
}): Promise<BrowserObservation> {
  async function sample() {
    const url = page.url();
    if (options.allowUrl && !options.allowUrl(url)) throw new Error('Prototype navigated outside the expected version/run routes');
    const dimensions = await page.evaluate(() => ({ viewport: { width: innerWidth, height: innerHeight }, scroll: { x: scrollX, y: scrollY } }));
    return { url, screenId: await screenId(page), ...dimensions, coordinateSpace: 'css-pixels' as const,
      controls: await observeControls(page, options.registry), alerts: await page.locator('[role="alert"]:visible').allTextContents() };
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const before = await sample();
    const png = await page.screenshot({ scale: 'css', fullPage: false, timeout: 5000 });
    const after = await sample();
    if (JSON.stringify(before) !== JSON.stringify(after)) continue;
    const observation = { ...after, screenshot: { uri: options.screenshotPath, ...after.viewport } };
    await mkdir(dirname(options.screenshotPath), { recursive: true });
    await writeFile(options.screenshotPath, png);
    await writeFile(`${options.screenshotPath}.observation.json`, JSON.stringify(observation, null, 2));
    return observation;
  }
  throw new Error('Page changed during all three observation attempts');
}

export async function execute(page: Page, action: Decision, registry?: ControlRegistryEntry[], allowNavigation?: (url: string) => boolean) {
  validateDecision(action, await observeControls(page, registry), allowNavigation ?? (url => url === page.url()));
  if (action.type === 'stop') return undefined;
  const byTestId = page.getByTestId(action.elementId);
  const target = await byTestId.count() ? byTestId : page.locator(`[data-agent-id="${action.elementId}"]`);
  if (action.type === 'type') await target.fill(action.value);
  if (action.type === 'select') await target.selectOption(action.value);
  if (action.type === 'click') {
    const b = await target.boundingBox();
    if (!b) throw new Error('Target disappeared');
    actualPointers.delete(page);
    await target.click({ position: { x: b.width / 2, y: b.height / 2 } });
    return actualPointers.get(page);
  }
  return undefined;
}
// Fixture-specific trusted state checker. Never included in the model prompt.
export async function checkPracticeGoal(page: Page): Promise<boolean> {
  const records: unknown = await page.evaluate(() => JSON.parse(sessionStorage.getItem('practice-workspaces') || '[]'));
  return Array.isArray(records) && records.length === 1 && records[0]?.name === 'Demo' && typeof records[0]?.id === 'string';
}
