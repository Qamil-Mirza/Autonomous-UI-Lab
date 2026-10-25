// Live sandbox test: real Docker containers, real npm install (needs network for the registry), real builds and
// previews, real Chromium. Opt in with GHOSTLOOP_DOCKER_TEST=1. No model calls.
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MutationPatch } from "@ghostloop/contracts";
import { runOne, type Decider } from "@ghostloop/simulator";
import { docker } from "../src/runtime/docker";
import { ImportService } from "../src/service";
import type { ImportRecord } from "../src/store";
import { taskRef } from "../src/task";
import { writeZip, type WriteEntry } from "./support/zip-writer";

const live = process.env.GHOSTLOOP_DOCKER_TEST === "1";
const FIXTURE = fileURLToPath(new URL("../fixtures/northwind-make-export", import.meta.url));

async function walk(dir: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(path.join(dir, e.name), r)));
    else out.push(r);
  }
  return out;
}
async function fixtureZip(edit?: (rel: string, data: Buffer) => Buffer): Promise<Buffer> {
  const entries: WriteEntry[] = [];
  for (const rel of await walk(FIXTURE)) {
    const data = await readFile(path.join(FIXTURE, rel));
    entries.push({ name: `Northwind export/${rel}`, data: edit ? edit(rel, data) : data });
  }
  return writeZip(entries);
}

let root = "";
let service: ImportService;
const commands = { created: [] as unknown[] };

async function waitFor(id: string, done: (r: ImportRecord) => boolean, ms = 8 * 60_000): Promise<ImportRecord> {
  const end = Date.now() + ms;
  for (;;) {
    const r = await service.get(id);
    if (done(r)) return r;
    if (Date.now() > end) throw new Error(`timed out in ${r.status}`);
    await new Promise((res) => setTimeout(res, 500));
  }
}
const settled = (r: ImportRecord) => ["ready_for_review", "ready_to_test", "failed", "cancelled"].includes(r.status);

describe.skipIf(!live)("imported app in the Docker sandbox (live)", () => {
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "gl-import-live-"));
    service = new ImportService({
      root: path.join(root, "store"),
      artifactsDir: path.join(root, "artifacts"),
      log: (l) => console.log(l),
      commands: {
        createExperiment: async (p) => (commands.created.push(p), { ok: true, value: { experimentId: "exp_livetest01" } }),
        startExperiment: async () => ({ ok: true, value: {} }),
      },
    });
    await service.init();
    expect((await service.runtimeStatus()).available).toBe(true);
  });
  afterAll(async () => {
    await service?.shutdown();
    const left = await docker(["ps", "-a", "--filter", `label=ghostloop.owner=${service.runtime.ownerId}`, "--format", "{{.Names}}"]);
    expect(left.stdout.trim()).toBe("");
    // Containers' files may be owned by the sandbox user; best effort.
    await rm(root, { recursive: true, force: true }).catch(() => {});
  });

  let importId = "";
  let baseVersionId = "";

  it("turns a Make-style ZIP into an isolated, running preview", async () => {
    const rec = await service.createImport({ name: "Northwind fixture", zip: await fixtureZip(), fileName: "northwind.zip" });
    importId = rec.id;
    const done = await waitFor(importId, settled);
    if (done.status !== "ready_for_review") console.log(JSON.stringify(done.error, null, 2));
    expect(done.status).toBe("ready_for_review");
    expect(done.report).toMatchObject({ wrapper: "Northwind export", viteConfig: "vite.config.ts" });
    baseVersionId = done.baseVersionId!;
    const v = await service.version(baseVersionId);
    const res = await fetch(`${service.previewUrl(v)}/`);
    expect(res.headers.get("x-ghostloop-preview")).toBe("1");
    expect(await res.text()).toContain('<div id="root"></div>');
    // SPA fallback serves deep links.
    expect((await fetch(`${service.previewUrl(v)}/order/confirmed`)).status).toBe(200);
    // Loopback only: the published port is bound to 127.0.0.1.
    const port = await docker(["port", `gl-preview-${baseVersionId}`, "8080/tcp"]);
    expect(port.stdout.trim()).toBe(`127.0.0.1:${v.port}`);
    // Hardened container.
    const inspect = JSON.parse((await docker(["inspect", `gl-preview-${baseVersionId}`])).stdout)[0];
    expect(inspect.HostConfig.ReadonlyRootfs).toBe(true);
    expect(inspect.HostConfig.CapDrop).toContain("ALL");
    expect(inspect.Config.User).toBe("1000:1000");
    expect(inspect.HostConfig.Binds.every((b: string) => !b.includes("docker.sock"))).toBe(true);
    expect(v.manifest.elements.some((e) => e.label === "Save bag" && e.supportedOps.includes("set_label"))).toBe(true);
  }, 10 * 60_000);

  it("verifies the task against the preview and freezes it", async () => {
    await expect(service.freeze(importId)).rejects.toThrow(/Save and verify/);
    await service.saveTask(importId, {
      task: "Order one flat white for pickup and get it confirmed.",
      startRoute: "/",
      viewport: { width: 1280, height: 800 },
      successChecks: [{ kind: "route", path: "/order/confirmed" }, { kind: "text", text: "Order confirmed" }],
      protectedTexts: ["Order confirmed"],
      inputs: { name: "Pat Example", email: "pat@example.com" },
    });
    await expect(service.freeze(importId)).rejects.toThrow(/Verify this exact task/);
    const v = await service.verify(importId);
    expect(v.ok).toBe(true);
    expect(v.controls.map((c) => c.ref)).toEqual(expect.arrayContaining(["button.add-flat-white", "button.bag"]));
    expect(v.checks.every((c) => !c.passedAtStart)).toBe(true);
    const frozen = await service.freeze(importId);
    expect(frozen.status).toBe("ready_to_test");
    // A start page that already satisfies every check is refused.
    await service.saveTask(importId, { task: "Look at the menu page and do nothing.", startRoute: "/", viewport: { width: 1280, height: 800 }, successChecks: [{ kind: "text", text: "Order ahead" }] });
    const bad = await service.verify(importId);
    expect(bad.ok).toBe(false);
    expect(bad.blockers.join(" ")).toMatch(/already passes/);
    await expect(service.freeze(importId)).rejects.toThrow(/blockers/);
  }, 120_000);

  it("runs an isolated browser session on the preview under the frozen task", async () => {
    // Restore and refreeze the real task.
    await service.saveTask(importId, {
      task: "Order one flat white for pickup and get it confirmed.",
      startRoute: "/",
      viewport: { width: 1280, height: 800 },
      successChecks: [{ kind: "route", path: "/order/confirmed" }, { kind: "text", text: "Order confirmed" }],
      protectedTexts: ["Order confirmed"],
      inputs: { name: "Pat Example", email: "pat@example.com" },
    });
    await service.verify(importId);
    const rec = await service.freeze(importId);
    const { experimentId } = await service.startExperiment(importId, { trials: 3, maxSteps: 12, maxUsd: 5, maxMinutes: 20, minImprovementPp: 10 });
    expect(experimentId).toBe("exp_livetest01");
    const created = commands.created.at(-1) as { protocol: { hiddenGoalRef: string; protectedElements: string[]; vetoRules: string[] } };
    expect(created.protocol.hiddenGoalRef).toBe(taskRef(rec.frozenTask!.hash));
    expect(created.protocol.vetoRules).toEqual([]);
    expect(created.protocol.protectedElements.length).toBe(1);

    const integration = await service.integrationFor({
      batchId: "batch_live1", experimentId: experimentId as never, protocolId: "proto_live1", versionId: baseVersionId as never, versionUrl: "http://127.0.0.1:1/",
      task: "Order one flat white for pickup and get it confirmed.", scenarios: [{ id: "scn_a", name: "A", description: "x", inputs: {}, runs: 1 }],
      runsPerBatch: 1, maxActionsPerRun: 12, maxConcurrency: 1, hiddenGoalRef: created.protocol.hiddenGoalRef,
    });
    const steps: [string, string, string?][] = [["click", "Add Flat white"], ["click", "Bag"], ["click", "Save bag"], ["type", "Name for the order", "Pat"], ["type", "Email for the receipt", "pat@example.com"], ["click", "Submit"]];
    let i = 0;
    const decide: Decider = async (_input, controls) => {
      const [type, label, value] = steps[i++] ?? ["stop", ""];
      const c = controls.find((x) => x.label === label);
      if (type === "stop" || !c) return { type: "stop", reason: `missing ${label}` };
      return type === "type" ? { type: "type", elementId: c.elementId, value: value! } : { type: "click", elementId: c.elementId };
    };
    const result = await runOne({ url: "http://unused", outputDir: path.join(root, "runs"), signal: new AbortController().signal, provenance: "mock-decisions", maxActions: 12, task: "Order one flat white for pickup and get it confirmed.", prototype: integration, decide });
    expect(result.outcome).toBe("goal");
    expect(result.stepCount).toBe(6);
  }, 180_000);

  it("creates a separate candidate from one approved text change and smoke-tests it", async () => {
    const base = await service.version(baseVersionId);
    const proceed = base.manifest.elements.find((e) => e.label === "Save bag")!;
    const patch = {
      schemaVersion: "1.0.0", id: "pat_live1", experimentId: "exp_livetest01", round: 1, sourceVersionId: baseVersionId,
      targetElementId: proceed.elementId, op: "set_label", value: "Continue to pickup details", observationIds: ["obs_1"],
      rationale: "say where the button goes", risk: "review_required", state: "approved",
    } as MutationPatch;
    await expect(service.createCandidate(baseVersionId, [{ ...patch, state: "proposed" } as MutationPatch])).rejects.toThrow(/not approved/);
    const cand = await service.createCandidate(baseVersionId, [patch]);
    expect(cand.versionId).not.toBe(baseVersionId);
    expect(cand.parentVersionId).toBe(baseVersionId);
    const v = await service.version(cand.versionId);
    expect(v.changes).toEqual([expect.objectContaining({ before: "Save bag", after: "Continue to pickup details" })]);
    // The original source is untouched.
    expect((await service.store.readSource(base.sourceHash)).get("src/components/Bag.tsx")!.toString()).toContain("Save bag");
    const validation = await service.validateCandidate(cand.id);
    console.log(validation.checks.map((c) => `${c.passed ? "✓" : "✗"} ${c.kind} ${c.name}: ${c.detail}`).join("\n"));
    expect(validation.ok).toBe(true);
    expect(validation.checks.map((c) => c.name)).toEqual(expect.arrayContaining(["build", "only_approved_text_changed", "protected_text_unchanged", "success_checks_unchanged", "start_route_renders", "structure_preserved"]));
    const html = await (await fetch(`${service.previewUrl(v)}/`)).text();
    expect(html).toContain('<div id="root"></div>');
  }, 10 * 60_000);

  it("reports a failing build with its log and keeps the original", async () => {
    const zip = await fixtureZip((rel, data) => (rel === "src/components/Menu.tsx" ? Buffer.from(data.toString().replace("</section>", "</sectoin>")) : data));
    const rec = await service.createImport({ name: "Broken fixture", zip });
    const done = await waitFor(rec.id, settled);
    expect(done.status).toBe("failed");
    expect(done.error).toMatchObject({ code: "BUILD_FAILED", step: "building" });
    expect(done.error!.logTail).toMatch(/Menu\.tsx/);
    // Dependencies were reused from the identical dependency set? No: another import never shares a volume.
    expect(done.baseVersionId).toBeDefined();
    await expect(service.ensurePreview(done.baseVersionId!)).rejects.toThrow(/no successful build/);
  }, 10 * 60_000);

  it("rejects an unsafe archive before anything runs", async () => {
    const rec = await service.createImport({ name: "Evil", zip: writeZip([{ name: "../../evil.sh", data: "rm -rf /" }]) });
    const done = await waitFor(rec.id, settled, 30_000);
    expect(done.status).toBe("failed");
    expect(done.error?.code).toBe("ARCHIVE_UNSAFE_PATH");
    expect(done.baseVersionId).toBeUndefined();
  });

  it("cancels an install in progress and removes its container", async () => {
    const zip = await fixtureZip((rel, data) => (rel === "package.json" ? Buffer.from(data.toString().replace('"lucide-react": "0.487.0"', '"lucide-react": "0.486.0"')) : data));
    const rec = await service.createImport({ name: "Cancel me", zip });
    await waitFor(rec.id, (r) => r.status === "installing" || settled(r), 60_000);
    await new Promise((r) => setTimeout(r, 1500));
    const cancelled = await service.cancel(rec.id);
    expect(cancelled.status).toBe("cancelled");
    await new Promise((r) => setTimeout(r, 3000));
    const left = await docker(["ps", "-a", "--filter", `label=ghostloop.import=${rec.id}`, "--format", "{{.Names}}"]);
    expect(left.stdout.trim()).toBe("");
    const after = await service.get(rec.id);
    expect(after.status).toBe("cancelled");
    // Retry is offered for cancelled imports.
    await service.retry(rec.id);
    await service.cancel(rec.id).catch(() => {});
  }, 120_000);
});
