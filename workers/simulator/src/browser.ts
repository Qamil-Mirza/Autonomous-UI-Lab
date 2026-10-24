import type { ControlRegistryEntry } from '@ghostloop/contracts';
import type { Page } from 'playwright';
import type { ObservedControl, Decision } from './actions';
import { validateDecision } from './actions';

export const viewport = { width: 1280, height: 800 };
export async function observeControls(page: Page, registry?: ControlRegistryEntry[]): Promise<ObservedControl[]> {
  const controls = await page.locator('[data-testid], [data-agent-id]').evaluateAll(elements => {
    const seen = new Set<string>();
    return elements.flatMap(el => {
      const node = el as HTMLInputElement;
      const id = node.getAttribute('data-testid') ?? node.getAttribute('data-agent-id') ?? '';
      if (!/^[a-zA-Z0-9_.-]+$/.test(id) || seen.has(id)) throw new Error('Control IDs must be unique and selector-safe');
      seen.add(id);
      const b = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      if (!b.width || !b.height || style.visibility === 'hidden' || style.display === 'none' || node.disabled || node.getAttribute('aria-disabled') === 'true') return [];
      if (b.top < 0 || b.left < 0 || b.bottom > innerHeight || b.right > innerWidth) return [];
      const tag = node.tagName.toLowerCase();
      const checkable = tag === 'input' && ['checkbox', 'radio'].includes(node.type);
      const allowedActions: ('click' | 'type' | 'select')[] = checkable ? ['click'] : tag === 'select' ? ['select'] : (tag === 'textarea' || (tag === 'input' && ['text', 'email', 'password', 'search', 'tel', 'url', 'number'].includes(node.type))) && !node.readOnly ? ['type'] : tag === 'button' || (tag === 'a' && node.hasAttribute('href')) ? ['click'] : [];
      if (!allowedActions.length) return [];
      return [{ elementId: id, role: checkable ? node.type : tag === 'input' ? 'textbox' : tag,
        label: node.getAttribute('aria-label') || node.labels?.[0]?.textContent?.trim() || node.textContent?.trim() || '',
        enabled: true, allowedActions,
        options: tag === 'select' ? Array.from((el as HTMLSelectElement).options).filter(o => !o.disabled).map(o => o.value) : undefined,
        bounds: { x: b.x, y: b.y, width: b.width, height: b.height } }];
    });
  });
  if (!registry) return controls;
  const screen = await screenId(page);
  return controls.filter(c => registry.some(r => r.elementId === c.elementId && r.screen === screen));
}
export async function execute(page: Page, action: Decision, registry?: ControlRegistryEntry[]) {
  validateDecision(action, await observeControls(page, registry));
  if (action.type === 'stop') return undefined;
  const byTestId = page.getByTestId(action.elementId);
  const target = await byTestId.count() ? byTestId : page.locator(`[data-agent-id="${action.elementId}"]`);
  if (action.type === 'type') await target.fill(action.value);
  if (action.type === 'select') await target.selectOption(action.value);
  if (action.type === 'click') {
    const b = await target.boundingBox();
    if (!b) throw new Error('Target disappeared');
    const pointer = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    await target.click({ position: { x: b.width / 2, y: b.height / 2 } });
    return pointer;
  }
  return undefined;
}
export async function screenId(page: Page) {
  const marker = page.locator('[data-screen]').first();
  if (await marker.count()) return await marker.getAttribute('data-screen') ?? 'unknown';
  return new URL(page.url()).pathname.match(/^\/v\/[^/]+\/([^/]+)$/)?.[1] ?? 'unknown';
}
// Fixture-specific trusted state checker. Never included in the model prompt.
export async function checkPracticeGoal(page: Page): Promise<boolean> {
  const records: unknown = await page.evaluate(() => JSON.parse(sessionStorage.getItem('practice-workspaces') || '[]'));
  return Array.isArray(records) && records.length === 1 && records[0]?.name === 'Demo' && typeof records[0]?.id === 'string';
}
