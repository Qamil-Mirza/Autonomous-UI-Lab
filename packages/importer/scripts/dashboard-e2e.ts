// End-to-end walkthrough of the import flow through the real dashboard UI (live worker, Docker, Bitdeer, Claude).
// Usage: tsx scripts/dashboard-e2e.ts <zip> <screenshotDir> [trials]
// Requires: SpacetimeDB, `npm run worker:real`, `npm run dev -w @ghostloop/dashboard`. Spends model credits.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";

const [zip, outDir, trialsArg] = process.argv.slice(2);
if (!zip || !outDir) throw new Error("usage: dashboard-e2e.ts <zip> <screenshotDir> [trials]");
const trials = Number(trialsArg ?? "3");
const DASH = process.env.DASHBOARD_URL ?? "http://localhost:5174";
await mkdir(outDir, { recursive: true });
let n = 0;
const shot = async (page: Page, name: string) => {
  const file = path.join(outDir, `${String(++n).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`screenshot ${file}`);
};
const log = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);

const browser = await chromium.launch({ headless: true, channel: process.env.SIMULATOR_BROWSER_CHANNEL || undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(30_000);
try {
  await page.goto(DASH);
  await page.getByRole("button", { name: /Open dashboard/ }).click();
  await page.getByRole("button", { name: "Import app" }).click();
  await page.getByLabel("Project name").fill(`Northwind fixture ${new Date().toISOString().slice(11, 16)}`);
  await page.getByLabel("Code ZIP").setInputFiles(zip);
  await shot(page, "upload-form");
  await page.getByRole("button", { name: "Upload and build" }).click();
  log("uploaded; waiting for the preview");
  await page.getByText("Ready for review", { exact: true }).first().waitFor({ timeout: 10 * 60_000 });
  await page.waitForTimeout(1500);
  await shot(page, "ready-for-review");

  await page.getByLabel(/Task description/).fill("Order one flat white for pickup and get the order confirmed.");
  await page.getByLabel("Text", { exact: true }).fill("Order confirmed");
  await page.getByRole("button", { name: "+ Add a check" }).click();
  await page.getByLabel("Route", { exact: true }).fill("/order/confirmed");
  await page.getByLabel(/Test data/).fill("name=Pat Example\nemail=pat@example.com");
  await page.getByLabel(/Protected behavior/).fill("Removing items from the bag keeps working.");
  await page.getByRole("button", { name: "Save task" }).click();
  await page.getByText("Saved.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Check preview and task" }).click();
  await page.getByText("The preview and task look right").waitFor({ timeout: 120_000 });
  await shot(page, "verified");
  await page.getByRole("button", { name: "Freeze and continue" }).click();
  await page.getByRole("button", { name: "Start the baseline test" }).waitFor();
  await page.getByLabel("Number of trials").fill(String(trials));
  await page.getByLabel("Maximum steps per trial").fill("10");
  await shot(page, "frozen");
  await page.getByRole("button", { name: "Start the baseline test" }).click();
  log("baseline started");
  await page.getByText(/Your first test is running|First test complete/).first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(20_000);
  await shot(page, "baseline-running");

  // Baseline + analysis: wait until recommendations are available or the test stops.
  const reviewBtn = page.getByRole("button", { name: "View recommendations" });
  const deadline = Date.now() + 30 * 60_000;
  for (;;) {
    if (await reviewBtn.isEnabled().catch(() => false)) break;
    if (await page.getByText(/Stopped|No usable suggestion|integration failure/).first().isVisible().catch(() => false)) {
      await shot(page, "baseline-stopped");
      throw new Error("experiment stopped before recommendations");
    }
    if (Date.now() > deadline) throw new Error("baseline did not finish in 30 minutes");
    await page.waitForTimeout(5000);
  }
  await page.waitForTimeout(1500);
  await shot(page, "baseline-done");
  log("baseline done; recommendations ready");
  await reviewBtn.click();
  await page.waitForTimeout(1000);
  await shot(page, "recommendations");
  const reviewSuggestions = page.getByRole("button", { name: "Review suggested improvements" });
  if (!(await reviewSuggestions.isEnabled())) {
    log("the analysis proposed no usable changes; the experiment stopped truthfully with NO_VALID_PATCH");
    process.exitCode = 2;
    throw new Error("no suggestions to approve");
  }
  await reviewSuggestions.click();
  await page.waitForTimeout(2000);
  await shot(page, "review");
  await page.getByRole("button", { name: "Test the selected improvements" }).click();
  log("approved; candidate building and retesting");
  const resultHead = page.getByText("How behavior changed");
  const noComparison = page.getByText("No comparison yet");
  const end2 = Date.now() + 30 * 60_000;
  for (;;) {
    if (await resultHead.isVisible().catch(() => false)) break;
    if (await noComparison.isVisible().catch(() => false)) {
      await page.waitForTimeout(3000);
      await shot(page, "no-comparison");
      log("stopped without a comparison");
      break;
    }
    if (Date.now() > end2) throw new Error("retest did not finish in 30 minutes");
    await page.waitForTimeout(5000);
  }
  await page.waitForTimeout(3000);
  await shot(page, "results");
  const text = (await page.locator("main").innerText()).replace(/\n+/g, " | ").slice(0, 1500);
  log(`results page: ${text}`);
} catch (err) {
  await shot(page, "error").catch(() => {});
  throw err;
} finally {
  await browser.close();
}
