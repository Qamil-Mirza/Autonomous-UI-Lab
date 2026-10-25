import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildManifest } from "../src/manifest";
import { ImportStore } from "../src/store";
import { FrozenTask, ImportTask } from "../src/task";

const newStore = async () => {
  const s = new ImportStore(await mkdtemp(path.join(tmpdir(), "gl-import-store-")));
  await s.init();
  return s;
};

describe("ImportStore", () => {
  it("stores source trees once, read-only, and verifies their hash on read", async () => {
    const s = await newStore();
    const files = new Map([["src/App.tsx", Buffer.from("<h1>Hi</h1>")], ["package.json", Buffer.from("{}")]]);
    const hash = await s.putSource(files);
    expect(await s.putSource(files)).toBe(hash);
    expect((await s.readSource(hash)).get("src/App.tsx")!.toString()).toBe("<h1>Hi</h1>");
    const file = path.join(s.dir.source(hash), "src/App.tsx");
    await expect(writeFile(file, "tampered")).rejects.toThrow();
    await chmod(file, 0o644);
    await writeFile(file, "tampered");
    await expect(s.readSource(hash)).rejects.toThrow(/modified/);
  });

  it("never overwrites a version record", async () => {
    const s = await newStore();
    const files = new Map([["src/App.tsx", Buffer.from("<h1>Hi</h1>")]]);
    const sourceHash = await s.putSource(files);
    const v = {
      schemaVersion: "1.0.0" as const,
      versionId: "ver_imp_aaaaaaaaaaaa",
      importId: "imp_aaaaaaaaaaaa",
      sourceHash,
      port: 47100,
      patchIds: [],
      changes: [],
      manifest: buildManifest({ versionId: "ver_imp_aaaaaaaaaaaa", sourceHash, files }),
      createdAt: new Date().toISOString(),
    };
    await s.insertVersion(v);
    await expect(s.insertVersion({ ...v, port: 47101 })).rejects.toThrow(/already exists/);
    expect((await s.getVersion(v.versionId))!.port).toBe(47100);
    expect(await s.getVersion("ver_baseline")).toBeUndefined();
  });

  it("refuses a frozen task edited after freezing", async () => {
    const s = await newStore();
    const frozen = FrozenTask.parse({
      schemaVersion: "1.0.0",
      importId: "imp_aaaaaaaaaaaa",
      baseVersionId: "ver_imp_aaaaaaaaaaaa",
      task: ImportTask.parse({ task: "Buy one coffee and confirm it.", startRoute: "/", viewport: { width: 1280, height: 800 }, successChecks: [{ kind: "route", path: "/done" }] }),
      frozenAt: new Date().toISOString(),
    });
    const hash = await s.putFrozenTask(frozen);
    expect((await s.getFrozenTask(hash))!.task.successChecks).toEqual([{ kind: "route", path: "/done", match: "exact" }]);
    const file = path.join(s.root, "tasks", `${hash}.json`);
    await chmod(file, 0o644);
    await writeFile(file, JSON.stringify({ ...frozen, task: { ...frozen.task, successChecks: [{ kind: "route", path: "/", match: "prefix" }] } }));
    await expect(s.getFrozenTask(hash)).rejects.toThrow(/modified/);
  });

  it("serializes concurrent record updates", async () => {
    const s = await newStore();
    const now = new Date().toISOString();
    await s.createImport({ schemaVersion: "1.0.0", id: "imp_aaaaaaaaaaaa", name: "x", createdAt: now, updatedAt: now, status: "uploading", attempt: 1, upload: { sha256: "0".repeat(64), bytes: 0 }, experiments: [] });
    await Promise.all(Array.from({ length: 10 }, (_, i) => s.updateImport("imp_aaaaaaaaaaaa", (r) => ({ ...r, experiments: [...r.experiments, { experimentId: `exp_${i}`, taskHash: "t", createdAt: now }] }))));
    expect((await s.getImport("imp_aaaaaaaaaaaa"))!.experiments).toHaveLength(10);
  });
});
