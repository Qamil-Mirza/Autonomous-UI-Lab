import { expect, test, type Page } from "@playwright/test";
import { checkGoal } from "@ghostloop/prototype-adapter";

const VERSION = "ver_baseline";

const newRunId = (label: string) => `run_e2e_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// Asserts the page is on `screen` and still carries this run in ?run=.
async function expectScreen(page: Page, screen: string, runId: string) {
  await expect(page).toHaveURL(new RegExp(`/v/${VERSION}/${screen}\\?run=${runId}$`));
}

async function onboard(page: Page, runId: string, plan: "free" | "pro") {
  await page.goto(`/v/${VERSION}/signup?run=${runId}`);
  await page.getByTestId("signup.name").fill("Alex Kim");
  await page.getByTestId("signup.email").fill("alex@northwind.test");
  await page.getByTestId("signup.password").fill("correct-horse");
  await page.getByTestId("signup.consent").check();
  await page.getByTestId("signup.submit").click();

  await expectScreen(page, "workspace", runId);
  await page.getByTestId("workspace.name").fill("Northwind Sales");
  await page.getByTestId("workspace.continue").click();

  await expectScreen(page, "plan", runId);
  await page.getByTestId(`plan.${plan}.cta`).click();

  await expectScreen(page, "invite", runId);
  await page.getByTestId("invite.email").fill("jordan@");
  await page.getByTestId("invite.send").click();
  await expect(page.getByTestId("invite.error")).toBeVisible();
  await page.getByTestId("invite.email").fill("jordan@northwind.test");
  await page.getByTestId("invite.send").click();

  await expectScreen(page, "confirm", runId);
}

test("Free happy path achieves the goal", async ({ page, request, baseURL }) => {
  const runId = newRunId("free");
  expect((await request.post(`/api/runs/${runId}/init`)).status()).toBe(201);
  await onboard(page, runId, "free");

  const result = await checkGoal(runId, { baseUrl: baseURL });
  expect(result.achieved).toBe(true);
  expect(result.checks.map((c) => [c.name, c.passed])).toEqual([
    ["account_created", true],
    ["exactly_one_workspace", true],
    ["free_plan_selected", true],
    ["invite_sent", true],
    ["no_paid_trial", true],
  ]);
});

test("choosing Pro fails the goal on no_paid_trial", async ({ page, request, baseURL }) => {
  const runId = newRunId("pro");
  expect((await request.post(`/api/runs/${runId}/init`)).status()).toBe(201);
  await onboard(page, runId, "pro");

  const result = await checkGoal(runId, { baseUrl: baseURL });
  expect(result.achieved).toBe(false);
  expect(result.checks.filter((c) => !c.passed).map((c) => c.name)).toEqual(["free_plan_selected", "no_paid_trial"]);
});

test("Back + resubmit keeps one workspace, and Back links keep ?run=", async ({ page, request, baseURL }) => {
  const runId = newRunId("back");
  await request.post(`/api/runs/${runId}/init`);
  await onboard(page, runId, "free");
  await page.goto(`/v/${VERSION}/invite?run=${runId}`);
  await page.getByTestId("invite.back").click();
  await expectScreen(page, "plan", runId);
  await page.getByTestId("plan.back").click();
  await expectScreen(page, "workspace", runId);
  await page.getByTestId("workspace.name").fill("Northwind Renamed");
  await page.getByTestId("workspace.continue").click();
  await expectScreen(page, "plan", runId);

  const state = await (await request.get(`/api/runs/${runId}/state`)).json();
  expect(state.workspaces.map((w: { name: string }) => w.name)).toEqual(["Northwind Renamed"]);
  expect((await checkGoal(runId, { baseUrl: baseURL })).achieved).toBe(true);
});

test("without ?run= the app creates a run_manual_* run", async ({ page, request }) => {
  await page.goto(`/v/${VERSION}/signup`);
  await expect(page).toHaveURL(/\?run=run_manual_[0-9a-f]{12}$/);
  const runId = new URL(page.url()).searchParams.get("run")!;
  const state = await request.get(`/api/runs/${runId}/state`);
  expect(state.status()).toBe(200);
  expect((await state.json()).account).toBeNull();
  await expect(page.getByTestId("signup.submit")).toBeVisible();
});

test("an uninitialized ?run= shows api-error and does not advance", async ({ page }) => {
  const runId = newRunId("uninit");
  await page.goto(`/v/${VERSION}/signup?run=${runId}`);
  await page.getByTestId("signup.name").fill("Alex Kim");
  await page.getByTestId("signup.email").fill("alex@northwind.test");
  await page.getByTestId("signup.password").fill("correct-horse");
  await page.getByTestId("signup.consent").check();
  await page.getByTestId("signup.submit").click();
  await expect(page.getByTestId("api-error")).toHaveText("Something went wrong. Try again.");
  await expectScreen(page, "signup", runId);
});
