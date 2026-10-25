import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openBrowserSession, observeControls, captureObservation, screenId, waitForObservationReady } from '../src/browser';
import { startFixture } from '../src/fixture';

async function withPage(test: (session: Awaited<ReturnType<typeof openBrowserSession>>, dir: string, url: string) => Promise<void>, retina = false) {
  const fixture = await startFixture();
  const dir = await mkdtemp(join(tmpdir(), 'ghostloop-observer-'));
  const session = await openBrowserSession({ url: fixture.url, signal: new AbortController().signal, deviceScaleFactor: retina ? 2 : 1 });
  try { await test(session, dir, fixture.url); }
  finally { await session.close(); await fixture.close(); await rm(dir, { recursive: true, force: true }); }
}

describe('browser observation', () => {
  it('extracts native types, accessible labels, current state and supported actions', async () => withPage(async ({ page }) => {
    await page.setContent(`<main data-screen="signup">
      <span id="name-label">Full name</span><input data-testid="signup.name" aria-labelledby="name-label" value="Example">
      <label>Password <input data-testid="signup.password" type="password" value="do-not-copy"></label>
      <label>Consent <input data-testid="signup.consent" type="checkbox" checked></label>
      <label>Notes <textarea data-testid="notes">hello</textarea></label>
      <select data-testid="plan" aria-label="Plan"><option value="free">Free</option><option disabled value="pro">Pro</option><optgroup disabled label="Other"><option value="hidden">Hidden</option></optgroup></select>
      <a data-testid="back" href="#back">Back</a><input data-testid="submit" type="submit" value="Continue">
      <span data-testid="decor.sparkle">*</span></main>`);
    const controls = await observeControls(page);
    const byId = Object.fromEntries(controls.map(c => [c.elementId, c]));
    expect(byId['signup.name']).toMatchObject({ label: 'Full name', role: 'textbox', inputType: 'text', value: 'Example', allowedActions: ['type'] });
    expect(byId['signup.password']).toMatchObject({ inputType: 'password', label: 'Password' });
    expect(byId['signup.password']?.value).toBeUndefined();
    expect(byId['signup.consent']).toMatchObject({ role: 'checkbox', checked: true, allowedActions: ['click'] });
    expect(byId.notes).toMatchObject({ tagName: 'textarea', role: 'textbox', value: 'hello' });
    expect(byId.plan).toMatchObject({ role: 'combobox', options: ['free'], allowedActions: ['select'] });
    expect(byId.back).toMatchObject({ role: 'link', allowedActions: ['click'] });
    expect(byId.submit).toMatchObject({ role: 'button', label: 'Continue' });
    expect(byId['decor.sparkle']).toBeUndefined();
  }), 15000);

  it('excludes disabled, inert, transparent, covered, readonly and offscreen controls', async () => withPage(async ({ page }) => {
    await page.setContent(`<style>button,input {display:block;height:22px;margin:2px}</style>
      <button data-testid="ok">OK</button>
      <button disabled data-testid="disabled">Disabled</button>
      <fieldset disabled><input data-testid="fieldset"></fieldset>
      <div aria-disabled="true"><button data-testid="aria">No</button></div>
      <div inert><button data-testid="inert">No</button></div>
      <div style="opacity:0"><button data-testid="transparent">No</button></div>
      <button style="display:none" data-testid="hidden">No</button>
      <button style="visibility:hidden" data-testid="invisible">No</button>
      <input readonly data-testid="readonly"><input aria-readonly="true" data-testid="ariareadonly">
      <button style="position:absolute;top:1200px" data-testid="offscreen">No</button>
      <button style="position:absolute;top:500px;left:10px;width:100px;height:30px" data-testid="covered">No</button>
      <div style="position:absolute;top:495px;left:5px;width:120px;height:50px;background:red;z-index:10"></div>`);
    expect((await observeControls(page)).map(c => c.elementId)).toEqual(['ok']);
  }), 15000);

  it('rejects duplicate IDs and filters controls by the current registered screen', async () => withPage(async ({ page }) => {
    await page.setContent('<main data-screen="signup"><button data-testid="signup.submit">Actual label</button><button data-testid="unknown">Unknown</button><button data-testid="other">Wrong screen</button></main>');
    const controls = await observeControls(page, [
      { elementId: 'signup.submit', screen: 'signup', role: 'button', label: 'Stale registry label' },
      { elementId: 'other', screen: 'plan', role: 'button', label: 'Other' },
    ]);
    expect(controls.map(c => c.elementId)).toEqual(['signup.submit']);
    expect(controls[0]?.label).toBe('Actual label');
    await page.setContent('<button data-testid="duplicate">A</button><button data-testid="duplicate">B</button>');
    await expect(observeControls(page)).rejects.toThrow('unique');
  }), 15000);

  it('saves matching CSS-scaled screenshot, bounds, alerts, screen and inventory on Retina', async () => withPage(async ({ page }, dir) => {
    await page.setContent('<main data-screen="invite"><button data-testid="invite.send" style="position:absolute;left:100px;top:120px;width:200px;height:40px">Send invite</button><p role="alert">Enter a valid email</p></main>');
    const result = await captureObservation(page, { screenshotPath: join(dir, 'screen.png') });
    expect(result).toMatchObject({ screenId: 'invite', coordinateSpace: 'css-pixels', viewport: { width: 1280, height: 800 }, alerts: ['Enter a valid email'] });
    expect(result.controls[0]?.bounds).toEqual({ x: 100, y: 120, width: 200, height: 40 });
    const png = await readFile(result.screenshot.uri);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1280, 800]);
    expect(JSON.parse(await readFile(`${result.screenshot.uri}.observation.json`, 'utf8'))).toEqual(result);
    await expect(captureObservation(page, { screenshotPath: join(dir, 'wrong.png'), allowUrl: () => false })).rejects.toThrow('outside');
  }, true), 15000);

  it('waits for delayed registry rendering and can observe a read-only terminal screen', async () => withPage(async ({ page }) => {
    await page.setContent('<main data-screen="confirm"></main><script>setTimeout(()=>{document.querySelector("main").innerHTML=\'<h1 data-testid="confirm.title">Done</h1>\'},100)</script>');
    await waitForObservationReady(page, [{ elementId: 'confirm.title', screen: 'confirm', role: 'heading', label: 'Done' }]);
    expect(await screenId(page)).toBe('confirm');
    expect(await observeControls(page)).toEqual([]);
  }), 15000);

  it('fails boundedly instead of pairing a screenshot with a changed inventory', async () => withPage(async ({ page }, dir) => {
    await page.setContent('<button data-testid="button">Start</button>');
    const screenshot = page.screenshot.bind(page);
    let n = 0;
    const spy = vi.spyOn(page, 'screenshot').mockImplementation(async options => {
      const png = await screenshot(options);
      await page.locator('button').evaluate((el, text) => { el.textContent = text; }, `Changed ${++n}`);
      return png;
    });
    await expect(captureObservation(page, { screenshotPath: join(dir, 'unstable.png') })).rejects.toThrow('three observation attempts');
    expect(spy).toHaveBeenCalledTimes(3);
    await expect(access(join(dir, 'unstable.png'))).rejects.toThrow();
    spy.mockRestore();
  }), 15000);

  it('opens the exact URL in fresh cookie/storage contexts and releases them on cancellation', async () => withPage(async ({ page }, _dir, url) => {
    await page.evaluate(() => { localStorage.setItem('test', 'private'); document.cookie = 'test=private'; });
    const controller = new AbortController();
    const second = await openBrowserSession({ url, signal: controller.signal });
    expect(second.page.url()).toBe(url);
    expect(await second.page.evaluate(() => [localStorage.getItem('test'), document.cookie])).toEqual([null, '']);
    const closed = second.page.waitForEvent('close');
    controller.abort();
    await closed;
    await second.close();
  }), 15000);
});
