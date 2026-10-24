import { randomUUID } from "node:crypto";
import { chromium, type Page } from "playwright";
import type { ValidationCheck } from "@ghostloop/contracts";
import type { PresentedElement } from "@ghostloop/design-engine";
import { checkGoal } from "./check-goal";

export const SCREENS = ["signup", "workspace", "plan", "invite", "confirm"] as const;
const CONTROL_ROLES = ["button", "textbox", "checkbox", "link"];
const TIMEOUT_MS = 10_000;

export interface BrowserCheckInput {
  baseUrl: string;
  versionId: string;
  elements: readonly PresentedElement[];
  // Used to name the fresh runs this validation creates.
  label: string;
}

export interface BrowserChecks {
  renders: ValidationCheck;
  smoke: ValidationCheck;
  accessible: ValidationCheck;
}

const fail = (name: string, kind: ValidationCheck["kind"], detail: string): ValidationCheck => ({ name, kind, passed: false, detail });
const firstLine = (err: unknown) => (err instanceof Error ? err.message : String(err)).split("\n")[0]!.trim();

function allFailed(detail: string): BrowserChecks {
  return {
    renders: fail("renders_all_screens", "runnable", detail),
    smoke: fail("onboarding_smoke", "runnable", detail),
    accessible: fail("accessible_labels", "guardrail", detail),
  };
}

async function initRun(baseUrl: string, runId: string): Promise<void> {
  const res = await fetch(new URL(`/api/runs/${runId}/init`, baseUrl), { method: "POST" });
  if (res.status !== 201) throw new Error(`POST /api/runs/${runId}/init returned ${res.status}`);
}

// Opens one screen and waits until it rendered either its controls or an error panel; returns the panel text if any.
async function openScreen(page: Page, url: string, screen: string): Promise<string | null> {
  await page.goto(url);
  const ready = page.locator(`[data-testid="manifest-error"], [data-testid="run-error"], [data-testid^="${screen}."]`).first();
  await ready.waitFor();
  const panel = page.locator('[data-testid="manifest-error"], [data-testid="run-error"]');
  return (await panel.count()) > 0 ? (await panel.first().innerText()).replace(/\s+/g, " ").trim() : null;
}

// Puts the screen's conditional alerts on screen with an empty or invalid client-side submit (no API call is made).
async function triggerAlerts(page: Page, screen: string): Promise<void> {
  if (screen === "signup") await page.getByTestId("signup.submit").click();
  if (screen === "workspace") await page.getByTestId("workspace.continue").click();
  if (screen === "invite") {
    await page.getByTestId("invite.email").fill("not-an-email");
    await page.getByTestId("invite.send").click();
  }
}

async function accessibleName(page: Page, testId: string): Promise<string> {
  const snapshot = await page.getByTestId(testId).first().ariaSnapshot();
  return /^- [\w-]+ "((?:[^"\\]|\\.)*)"/.exec(snapshot.trim())?.[1]?.trim() ?? "";
}

async function isKeyboardFocusable(page: Page, testId: string): Promise<boolean> {
  return page
    .getByTestId(testId)
    .first()
    .evaluate((el) => {
      const node = el as HTMLElement & { disabled?: boolean };
      node.focus();
      return document.activeElement === node && node.tabIndex >= 0 && !node.disabled;
    });
}

async function scriptedFreePath(page: Page, baseUrl: string, versionId: string, runId: string): Promise<void> {
  // Each step names its control, so a failure says where the flow broke.
  const step = async (what: string, action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (err) {
      throw new Error(`${what}: ${firstLine(err)}`);
    }
  };
  const at = (screen: string) => step(`reach ${screen}`, () => page.waitForURL((u) => u.pathname === `/v/${versionId}/${screen}`));
  const fill = (id: string, value: string) => step(`fill ${id}`, () => page.getByTestId(id).fill(value));
  const click = (id: string) => step(`click ${id}`, () => page.getByTestId(id).click());

  await step("open signup", () => page.goto(`${baseUrl}/v/${versionId}/signup?run=${runId}`));
  await fill("signup.name", "Alex Kim");
  await fill("signup.email", "alex@northwind.test");
  await fill("signup.password", "correct-horse");
  await step("check signup.consent", () => page.getByTestId("signup.consent").check());
  await click("signup.submit");
  await at("workspace");
  await fill("workspace.name", "Northwind Sales");
  await click("workspace.continue");
  await at("plan");
  await click("plan.free.cta");
  await at("invite");
  await fill("invite.email", "jordan@northwind.test");
  await click("invite.send");
  await at("confirm");
}

/**
 * Loads the candidate in headless Chromium at 1280×800. Never throws: an unreachable server or a browser that won't
 * launch fails all three checks with that reason.
 */
export async function runBrowserChecks(input: BrowserCheckInput): Promise<BrowserChecks> {
  const { baseUrl, versionId, elements } = input;
  try {
    await fetch(baseUrl, { signal: AbortSignal.timeout(5_000) });
  } catch (err) {
    const cause = (err as { cause?: { code?: string } }).cause?.code ?? firstLine(err);
    return allFailed(`app server not reachable at ${baseUrl}: ${cause}`);
  }

  let browser;
  try {
    browser = await chromium.launch();
  } catch (err) {
    return allFailed(`could not launch Chromium: ${firstLine(err)}`);
  }

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    context.setDefaultTimeout(TIMEOUT_MS);
    const suffix = randomUUID().replace(/-/g, "").slice(0, 8);

    // renders_all_screens + accessible_labels, on one fresh run.
    const renderProblems: string[] = [];
    const a11yProblems: string[] = [];
    let controlsChecked = 0;
    try {
      const runId = `run_validate_${input.label}_render_${suffix}`;
      await initRun(baseUrl, runId);
      const page = await context.newPage();
      for (const screen of SCREENS) {
        const panel = await openScreen(page, `${baseUrl}/v/${versionId}/${screen}?run=${runId}`, screen);
        if (panel) {
          renderProblems.push(`${screen}: error panel "${panel}"`);
          a11yProblems.push(`${screen}: not rendered`);
          continue;
        }
        const onScreen = elements.filter((e) => e.screen === screen);
        const checkPresence = async (els: readonly PresentedElement[]) => {
          for (const e of els) {
            const visible = await page.getByTestId(e.elementId).first().isVisible();
            if (e.visible !== false && !visible) renderProblems.push(`${screen}: ${e.elementId} is not visible`);
            if (e.visible === false && (await page.getByTestId(e.elementId).count()) > 0) renderProblems.push(`${screen}: hidden ${e.elementId} is rendered`);
          }
        };
        await checkPresence(onScreen.filter((e) => e.role !== "alert"));
        for (const e of onScreen.filter((e) => e.visible !== false && CONTROL_ROLES.includes(e.role))) {
          if ((await page.getByTestId(e.elementId).count()) === 0) continue; // already reported as a render problem
          controlsChecked++;
          if ((await accessibleName(page, e.elementId)) === "") a11yProblems.push(`${e.elementId} has no accessible name`);
          if (!(await isKeyboardFocusable(page, e.elementId))) a11yProblems.push(`${e.elementId} is not keyboard-focusable`);
        }
        const alerts = onScreen.filter((e) => e.role === "alert");
        if (alerts.length > 0) {
          await triggerAlerts(page, screen);
          await checkPresence(alerts);
        }
      }
    } catch (err) {
      renderProblems.push(`render pass aborted: ${firstLine(err)}`);
      a11yProblems.push(`render pass aborted: ${firstLine(err)}`);
    }

    // onboarding_smoke, on its own fresh run.
    let smoke: ValidationCheck;
    const smokeRun = `run_validate_${input.label}_smoke_${suffix}`;
    try {
      await initRun(baseUrl, smokeRun);
      await scriptedFreePath(await context.newPage(), baseUrl, versionId, smokeRun);
      const goal = await checkGoal(smokeRun, { baseUrl });
      const failed = goal.checks.filter((c) => !c.passed).map((c) => `${c.name} (${c.detail})`);
      smoke = goal.achieved
        ? { name: "onboarding_smoke", kind: "runnable", passed: true, detail: `${smokeRun}: Free happy path achieved the goal` }
        : fail("onboarding_smoke", "runnable", `${smokeRun}: goal not achieved: ${failed.join("; ")}`);
    } catch (err) {
      smoke = fail("onboarding_smoke", "runnable", `${smokeRun}: scripted Free path failed: ${firstLine(err)}`);
    }

    return {
      renders:
        renderProblems.length === 0
          ? { name: "renders_all_screens", kind: "runnable", passed: true, detail: `${SCREENS.length} screens, every visible element present` }
          : fail("renders_all_screens", "runnable", renderProblems.join("; ")),
      smoke,
      accessible:
        a11yProblems.length === 0
          ? { name: "accessible_labels", kind: "guardrail", passed: true, detail: `${controlsChecked} controls named and keyboard-focusable` }
          : fail("accessible_labels", "guardrail", a11yProblems.join("; ")),
    };
  } finally {
    await browser.close();
  }
}
