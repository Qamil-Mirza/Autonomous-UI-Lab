import type { Page } from 'playwright';
import type { ObservedControl } from './actions';

/** Attribute the discovery pass writes so the executor can find the element the model chose. */
export const REF_ATTRIBUTE = 'data-gl-ref';

/**
 * Discovers visible, enabled, actionable controls on an arbitrary rendered page (no test IDs required) and tags
 * each with a reference built from its role and accessible name, e.g. `button.continue-to-checkout`, numbered in
 * document order when names repeat. The same page always yields the same references, so a reference the model
 * chose from one observation can be re-resolved and re-validated against the live page right before execution.
 *
 * A script string, not a function: the page runs it verbatim (tsx would otherwise inject a Node-only helper).
 */
const DISCOVER = String.raw`(() => {
  var SELECTOR = 'button, a[href], input, textarea, select, summary, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="combobox"], [role="textbox"], [contenteditable="true"], [contenteditable=""]';
  var CLICK_ROLES = ['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'combobox'];
  var TEXT_TYPES = ['text', 'email', 'password', 'search', 'tel', 'url', 'number', 'date', 'datetime-local', 'month', 'time', 'week'];
  document.querySelectorAll('[${REF_ATTRIBUTE}]').forEach(function (e) { e.removeAttribute('${REF_ATTRIBUTE}'); });
  var counts = {};
  var out = [];
  var all = Array.prototype.slice.call(document.querySelectorAll(SELECTOR));
  for (var i = 0; i < all.length; i++) {
    var node = all[i];
    // Keep the outermost of nested interactive elements (e.g. a button inside a link).
    var parent = node.parentElement ? node.parentElement.closest(SELECTOR) : null;
    if (parent && parent.tagName.toLowerCase() !== 'label') continue;
    var tag = node.tagName.toLowerCase();
    var type = tag === 'input' ? (node.getAttribute('type') || 'text').toLowerCase() : '';
    if (tag === 'input' && ['hidden', 'file', 'range', 'color', 'image'].indexOf(type) >= 0) continue;
    var b = node.getBoundingClientRect();
    if (!b.width || !b.height) continue;
    if (node.matches(':disabled') || node.closest('[inert], [aria-disabled="true"], [aria-hidden="true"]')) continue;
    var hidden = false;
    for (var a = node; a; a = a.parentElement) {
      var st = getComputedStyle(a);
      if (st.visibility === 'hidden' || st.visibility === 'collapse' || st.display === 'none' || Number(st.opacity) === 0) { hidden = true; break; }
    }
    if (hidden) continue;
    if (b.top < 0 || b.left < 0 || b.bottom > innerHeight + 0.5 || b.right > innerWidth + 0.5) continue;
    var hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    if (!hit || (hit !== node && !node.contains(hit) && !(hit.tagName === 'LABEL' && hit.control === node))) continue;
    var explicit = (node.getAttribute('role') || '').toLowerCase();
    var checkable = tag === 'input' && (type === 'checkbox' || type === 'radio');
    var role = explicit || (checkable ? type : tag === 'select' ? 'combobox' : tag === 'textarea' || (tag === 'input' && TEXT_TYPES.indexOf(type) >= 0) ? 'textbox'
      : tag === 'a' ? 'link' : 'button');
    var editable = node.isContentEditable || role === 'textbox';
    var writable = editable && !node.readOnly && node.getAttribute('aria-readonly') !== 'true';
    var nativeSelect = tag === 'select' && !node.multiple;
    var actions = nativeSelect ? ['select'] : writable && (tag === 'input' || tag === 'textarea' || node.isContentEditable) ? ['type']
      : CLICK_ROLES.indexOf(role) >= 0 || tag === 'button' || tag === 'a' || tag === 'summary' || checkable ? ['click'] : [];
    if (!actions.length) continue;
    var labelledBy = (node.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
      .map(function (id) { var el = document.getElementById(id); return el ? el.textContent || '' : ''; }).join(' ').trim();
    var labels = node.labels ? Array.prototype.map.call(node.labels, function (l) { return l.textContent || ''; }).join(' ') : '';
    var imgAlt = '';
    var img = node.querySelector ? node.querySelector('img[alt]') : null;
    if (img) imgAlt = img.getAttribute('alt') || '';
    var text = tag === 'input' && ['submit', 'button', 'reset'].indexOf(type) >= 0 ? node.value
      : actions[0] === 'type' || nativeSelect ? '' : (node.innerText || node.textContent || '');
    var label = (labelledBy || node.getAttribute('aria-label') || labels || text || node.getAttribute('placeholder') || node.getAttribute('title') || imgAlt || node.getAttribute('name') || '')
      .replace(/\s+/g, ' ').trim().slice(0, 120);
    var slug = label.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'unnamed';
    var base = role.replace(/[^a-z]/g, '') + '.' + slug;
    counts[base] = (counts[base] || 0) + 1;
    var ref = counts[base] === 1 ? base : base + '-' + counts[base];
    node.setAttribute('${REF_ATTRIBUTE}', ref);
    var form = node.form || null;
    var navigationUrl;
    if (tag === 'a') navigationUrl = node.href;
    else if (form && (type === 'submit' || (tag === 'button' && (node.getAttribute('type') || 'submit') === 'submit'))) {
      var action = node.getAttribute('formaction') !== null ? node.formAction : form.getAttribute('action') !== null ? form.action : undefined;
      if (action) navigationUrl = action;
    }
    var opens;
    if (tag === 'a') opens = node.hasAttribute('download') || ['', '_self'].indexOf(node.target || '') < 0;
    out.push({
      elementId: ref, role: role, label: label, enabled: true, tagName: tag,
      inputType: tag === 'input' ? type : undefined,
      value: (tag === 'input' || tag === 'textarea' || tag === 'select') && type !== 'password' && !checkable ? String(node.value).slice(0, 500) : undefined,
      checked: checkable ? node.checked : node.hasAttribute('aria-checked') ? node.getAttribute('aria-checked') === 'true' : undefined,
      maxLength: actions[0] === 'type' && node.maxLength >= 0 ? node.maxLength : undefined,
      navigationUrl: navigationUrl, opensNewContext: opens, allowedActions: actions,
      options: nativeSelect ? Array.prototype.filter.call(node.options, function (o) { return !o.disabled && !o.closest('optgroup[disabled]'); }).map(function (o) { return o.value; }) : undefined,
      bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
      selectorHint: tag + (node.id ? '#' + node.id : '') + (node.getAttribute('name') ? '[name=' + node.getAttribute('name') + ']' : ''),
    });
  }
  return out;
})()`;

/** Screen identity for apps without screen markers: the route, plus the first visible h1/h2 for state-driven apps. */
const SCREEN = String.raw`(() => {
  var path = location.pathname + (location.hash.indexOf('#/') === 0 ? location.hash : '');
  var hs = document.querySelectorAll('h1, h2, [role="heading"][aria-level="1"], [role="heading"][aria-level="2"]');
  for (var i = 0; i < hs.length; i++) {
    var r = hs[i].getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(hs[i]).visibility === 'hidden') continue;
    var t = (hs[i].innerText || hs[i].textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (t) return path + ' · ' + t;
  }
  return path;
})()`;

/** Visible messages a person would read as feedback: alerts, live regions and toasts. */
const ALERTS = String.raw`(() => {
  var seen = [];
  var els = document.querySelectorAll('[role="alert"], [aria-live="assertive"], [aria-live="polite"], [data-sonner-toast], [role="status"]');
  for (var i = 0; i < els.length; i++) {
    var r = els[i].getBoundingClientRect();
    if (!r.width || !r.height) continue;
    var t = (els[i].innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (t && seen.indexOf(t) < 0) seen.push(t);
  }
  return seen;
})()`;

const READY = String.raw`(() => {
  var b = document.body;
  if (!b) return false;
  if ((b.innerText || '').trim().length > 0) return true;
  return !!document.querySelector('img, svg, canvas, video, input, button');
})()`;

export type DiscoveredControl = ObservedControl & { selectorHint?: string };

export async function discoverControls(page: Page): Promise<DiscoveredControl[]> {
  return await page.evaluate(DISCOVER) as DiscoveredControl[];
}

export async function discoveryScreenId(page: Page): Promise<string> {
  return await page.evaluate(SCREEN) as string;
}

export async function discoveryAlerts(page: Page): Promise<string[]> {
  return await page.evaluate(ALERTS) as string[];
}

/** Waits until the app rendered something and network activity has settled (bounded). */
export async function waitForDiscoveryReady(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
  await page.waitForFunction(READY, undefined, { timeout: 8000 });
  await page.evaluate('document.fonts ? document.fonts.ready.then(function () { return undefined; }) : undefined');
}

/** The element a reference from the latest discovery pass names. */
export const refSelector = (ref: string) => `[${REF_ATTRIBUTE}="${ref.replace(/["\\]/g, '')}"]`;
