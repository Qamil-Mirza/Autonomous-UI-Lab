import type { Page } from "playwright";
import { GoalCheckResult } from "@ghostloop/contracts";
import { checkName, describeCheck, type SuccessCheck } from "./task";

const strip = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Visible-text probes; script strings (not functions) so tsx cannot inject helpers into the page. */
const textScript = (text: string, exact: boolean) => `(() => {
  var want = ${JSON.stringify(text)}.replace(/\\s+/g, ' ').trim().toLowerCase();
  var body = document.body;
  if (!body) return { found: false, sample: '' };
  var all = (body.innerText || '').replace(/\\s+/g, ' ').trim();
  if (!${exact}) return { found: all.toLowerCase().indexOf(want) >= 0, sample: all.slice(0, 160) };
  var els = body.querySelectorAll('*');
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    var t = (el.innerText || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    if (t !== want) continue;
    var r = el.getBoundingClientRect();
    if (r.width && r.height) return { found: true, sample: t };
  }
  return { found: false, sample: all.slice(0, 160) };
})()`;

/** Evaluates one check against the live page. Throws only when the page itself cannot be read. */
export async function evaluateCheck(page: Page, check: SuccessCheck): Promise<{ name: string; passed: boolean; detail: string }> {
  const name = checkName(check);
  switch (check.kind) {
    case "route": {
      const url = new URL(page.url());
      const actual = check.path.startsWith("#") ? url.hash || "#" : url.pathname;
      const passed = check.match === "prefix" ? strip(actual).startsWith(strip(check.path)) : strip(actual) === strip(check.path);
      return { name, passed, detail: `${describeCheck(check)} Current: ${actual}.` };
    }
    case "text": {
      const r = (await page.evaluate(textScript(check.text, check.match === "exact"))) as { found: boolean; sample: string };
      return { name, passed: r.found, detail: `${describeCheck(check)} ${r.found ? "Found." : "Not found."}` };
    }
    case "control": {
      const n = await page
        .getByRole(check.role, { name: new RegExp(`^\\s*${escapeRe(check.name)}\\s*$`, "i") })
        .filter({ visible: true })
        .count();
      return { name, passed: n > 0, detail: `${describeCheck(check)} ${n > 0 ? `Found ${n}.` : "Not found."}` };
    }
  }
}

/**
 * GhostLoop's independent checker for imported apps: every frozen check is evaluated by code against the page the
 * simulated user is on; success means all pass. Neither the acting model nor the proposing model is consulted.
 */
export async function evaluateChecks(page: Page, checks: readonly SuccessCheck[], runId: string): Promise<GoalCheckResult> {
  const results = [];
  for (const c of checks) results.push(await evaluateCheck(page, c));
  return GoalCheckResult.parse({ runId, achieved: results.every((r) => r.passed), checks: results, at: new Date().toISOString() });
}
