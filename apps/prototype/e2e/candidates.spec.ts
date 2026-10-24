import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { newId, type MutationPatch } from "@ghostloop/contracts";
import { computeManifestHash } from "@ghostloop/design-engine/patch";
import { createCandidateAdapter } from "@ghostloop/prototype-adapter";
import { E2E_DESIGNS_DIR } from "./dirs";

// Each validation drives its own headless browser, so allow more than the default 30 s.
test.setTimeout(60_000);

const approved = (targetElementId: string, op: MutationPatch["op"], value: string | boolean): MutationPatch =>
  ({
    schemaVersion: "1.0.0",
    id: newId("pat"),
    experimentId: "exp_e2e",
    round: 1,
    sourceVersionId: "ver_baseline",
    targetElementId,
    op,
    value,
    observationIds: ["obs_e2e"],
    rationale: "e2e",
    risk: "review_required",
    state: "approved",
  }) as MutationPatch;

// Rewrites a candidate's manifest on disk, keeping its hash consistent so only the targeted check can catch it.
async function tamper(versionId: string, edit: (el: Record<string, unknown>) => void, elementId: string) {
  const file = path.join(E2E_DESIGNS_DIR, "versions", `${versionId}.json`);
  const m = JSON.parse(await readFile(file, "utf8"));
  edit(m.elements.find((e: { elementId: string }) => e.elementId === elementId));
  m.manifestHash = computeManifestHash(m.elements);
  await writeFile(file, JSON.stringify(m, null, 2));
}

test("a valid candidate passes every check, and its patch is live in the app", async ({ page, baseURL }) => {
  const adapter = createCandidateAdapter({ baseUrl: baseURL!, designsDir: E2E_DESIGNS_DIR });
  const c = await adapter.createCandidate("ver_baseline", [approved("plan.free.cta", "set_label", "Continue with Free plan"), approved("plan.free.note", "set_visibility", true)]);
  const v = await adapter.validateCandidate(c.id);
  expect(v.checks.filter((ch) => !ch.passed)).toEqual([]);
  expect(v.ok).toBe(true);

  await page.goto(c.url.replace("/signup", "/plan"));
  await expect(page.getByTestId("plan.free.cta")).toHaveText("Continue with Free plan");
  await expect(page.getByTestId("plan.free.note")).toHaveText("No card required");
});

test("a tampered protected element fails protected_elements_unchanged", async ({ baseURL }) => {
  const adapter = createCandidateAdapter({ baseUrl: baseURL!, designsDir: E2E_DESIGNS_DIR });
  const c = await adapter.createCandidate("ver_baseline", [approved("plan.free.cta", "set_label", "Continue with Free plan")]);
  await tamper(c.versionId, (el) => (el.label = "Free forever"), "plan.pro.price");
  const v = await adapter.validateCandidate(c.id);
  expect(v.ok).toBe(false);
  expect(v.checks.filter((ch) => !ch.passed).map((ch) => [ch.name, ch.detail])).toEqual([
    ["protected_elements_unchanged", 'plan.pro.price label changed from "$12 / user / month" to "Free forever"'],
  ]);
});

test("an unlabeled control fails accessible_labels in the browser", async ({ baseURL }) => {
  const adapter = createCandidateAdapter({ baseUrl: baseURL!, designsDir: E2E_DESIGNS_DIR });
  const c = await adapter.createCandidate("ver_baseline", [approved("plan.free.cta", "set_label", "Continue with Free plan")]);
  await tamper(c.versionId, (el) => (el.label = ""), "plan.free.cta");
  const v = await adapter.validateCandidate(c.id);
  const failed = Object.fromEntries(v.checks.filter((ch) => !ch.passed).map((ch) => [ch.name, ch.detail]));
  expect(failed).toEqual({ accessible_labels: "plan.free.cta has no accessible name" });
});

test("a candidate that hides the Free plan button fails onboarding_smoke", async ({ baseURL }) => {
  const adapter = createCandidateAdapter({ baseUrl: baseURL!, designsDir: E2E_DESIGNS_DIR });
  const c = await adapter.createCandidate("ver_baseline", [approved("plan.free.cta", "set_label", "Continue with Free plan")]);
  // plan.free.cta doesn't support set_visibility, so the engine would refuse this; tampering the file shows the
  // runnable checks catch a candidate that renders consistently but blocks the workflow.
  await tamper(c.versionId, (el) => (el.visible = false), "plan.free.cta");
  const v = await adapter.validateCandidate(c.id);
  const failed = Object.fromEntries(v.checks.filter((ch) => !ch.passed).map((ch) => [ch.name, ch.detail]));
  expect(Object.keys(failed)).toEqual(["onboarding_smoke"]);
  expect(failed.onboarding_smoke).toMatch(/scripted Free path failed: click plan\.free\.cta: locator\.click: Timeout/);
});
