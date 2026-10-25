import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requireDocker } from "../src/runtime/docker";
import { ImportService } from "../src/service";
import type { ImportRecord } from "../src/store";
import { makeExport } from "./support/zip-writer";

let prev: string | undefined;
beforeEach(() => {
  prev = process.env.GHOSTLOOP_DOCKER_BIN;
  process.env.GHOSTLOOP_DOCKER_BIN = "/nonexistent/ghostloop-docker";
});
afterEach(() => {
  if (prev === undefined) delete process.env.GHOSTLOOP_DOCKER_BIN;
  else process.env.GHOSTLOOP_DOCKER_BIN = prev;
});

async function settle(s: ImportService, id: string): Promise<ImportRecord> {
  for (let i = 0; i < 100; i++) {
    const r = await s.get(id);
    if (["failed", "cancelled", "ready_for_review"].includes(r.status)) return r;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error("did not settle");
}

describe("without an isolation runtime", () => {
  it("requireDocker explains the setup requirement", async () => {
    await expect(requireDocker()).rejects.toMatchObject({ code: "RUNTIME_UNAVAILABLE", hint: expect.stringMatching(/never runs uploaded code directly/) });
  });

  it("validates and stores the upload, then fails clearly instead of building on the host", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gl-noruntime-"));
    const s = new ImportService({ root: dir, artifactsDir: dir });
    await s.init();
    expect(await s.runtimeStatus()).toMatchObject({ available: false, error: { code: "RUNTIME_UNAVAILABLE" } });
    const rec = await s.createImport({ name: "No Docker", zip: makeExport() });
    const done = await settle(s, rec.id);
    expect(done.status).toBe("failed");
    expect(done.error).toMatchObject({ code: "RUNTIME_UNAVAILABLE", step: "installing" });
    // Validation still ran and the immutable version exists; nothing was built.
    expect(done.baseVersionId).toMatch(/^ver_imp_/);
    expect(await s.store.getBuild(done.baseVersionId!)).toMatchObject({ status: "pending" });
    await expect(s.ensurePreview(done.baseVersionId!)).rejects.toThrow(/no successful build/);
  });

  it("rejects bad input and actions in the wrong state", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gl-noruntime-"));
    const s = new ImportService({ root: dir, artifactsDir: dir });
    await s.init();
    await expect(s.createImport({ name: " ", zip: makeExport() })).rejects.toMatchObject({ code: "INVALID_TASK" });
    await expect(s.createImport({ name: "x", figmaUrl: "https://evil.example/file", zip: makeExport() })).rejects.toThrow(/figma.com/);
    const rec = await s.createImport({ name: "x", figmaUrl: "https://www.figma.com/make/abc/My-App", zip: makeExport() });
    await settle(s, rec.id);
    await expect(s.saveTask(rec.id, { task: "Do the thing well.", startRoute: "/", viewport: { width: 1280, height: 800 }, successChecks: [{ kind: "route", path: "/done" }] })).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(s.startExperiment(rec.id, { trials: 1, maxSteps: 5, maxUsd: 1, maxMinutes: 5, minImprovementPp: 10 })).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(s.cancel(rec.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
    const retried = await s.retry(rec.id);
    expect(retried.attempt).toBe(2);
    expect((await settle(s, rec.id)).error?.code).toBe("RUNTIME_UNAVAILABLE");
  });

  it("imported batches require a frozen task reference", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gl-noruntime-"));
    const s = new ImportService({ root: dir, artifactsDir: dir });
    await s.init();
    await expect(
      s.integrationFor({ batchId: "batch_x", experimentId: "exp_x", protocolId: "proto_x", versionId: "ver_imp_aaaaaaaaaaaa", versionUrl: "http://127.0.0.1:1/", task: "t", scenarios: [{ id: "scn_a", name: "a", description: "", inputs: {}, runs: 1 }], runsPerBatch: 1, maxActionsPerRun: 1, maxConcurrency: 1, hiddenGoalRef: "goal.onboarding.free-plan" }),
    ).rejects.toThrow(/frozen import task/);
  });
});
