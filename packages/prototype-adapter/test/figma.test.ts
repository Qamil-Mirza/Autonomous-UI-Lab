import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FigmaReference } from "@ghostloop/contracts";
import { FigmaSnapshot } from "@ghostloop/design-engine";
import { applyPatches, computeManifestHash } from "@ghostloop/design-engine/patch";
import { buildFigmaMapping, createFigmaApi, FIGMA_METHOD, FigmaMapping, readVersion, writeFigmaMapping } from "../src";

const repoBaseline = new URL("../../../designs/versions/ver_baseline.json", import.meta.url);
const snapshot = (): FigmaSnapshot =>
  FigmaSnapshot.parse(JSON.parse(readFileSync(new URL("../../design-engine/test/fixtures/figma-baseline-snapshot.json", import.meta.url), "utf8")));
const PAGE_URL = "https://www.figma.com/design/hUYlyMbzUB2LnefdcudZOb/Calhacks-13.0?node-id=15-122";

let dir = "";
let server: Server;
let baseUrl = "";

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ghostloop-figma-"));
  await mkdir(path.join(dir, "versions"));
  await copyFile(repoBaseline, path.join(dir, "versions", "ver_baseline.json"));
  const api = createFigmaApi({ designsDir: dir });
  server = createServer((req, res) =>
    api(req, res, (err) => {
      res.statusCode = err ? 500 : 404;
      res.end();
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

// Candidate B: the free CTA relabelled, written to versions/ like the CandidateAdapter does.
async function writeCandidateB() {
  const base = await readVersion(dir, "ver_baseline");
  const patched = applyPatches(base, [
    {
      schemaVersion: "1.0.0",
      id: "pat_figmatest",
      experimentId: "exp_test",
      round: 1,
      sourceVersionId: "ver_baseline",
      targetElementId: "plan.free.cta",
      op: "set_label",
      value: "Continue with Free plan",
      observationIds: ["obs_1"],
      rationale: "test",
      risk: "review_required",
      state: "approved",
    },
  ]);
  const manifest = { ...patched, versionId: "ver_b", parentVersionId: "ver_baseline", manifestHash: computeManifestHash(patched.elements) };
  await writeFile(path.join(dir, "versions", "ver_b.json"), JSON.stringify(manifest));
  return manifest;
}

function variantSnapshot(): FigmaSnapshot {
  const plan = structuredClone(snapshot().frames.find((f) => f.name === "plan")!);
  plan.nodeId = "60:1";
  plan.name = "plan · ver_b";
  plan.elements["plan.free.cta"]!.texts = ["Continue with Free plan"];
  return { fileKey: "hUYlyMbzUB2LnefdcudZOb", frames: [plan] };
}

describe("buildFigmaMapping", () => {
  it("records a verified baseline as a superset of the contract FigmaReference", async () => {
    const m = buildFigmaMapping({ manifest: await readVersion(dir, "ver_baseline"), snapshot: snapshot(), frameUrl: PAGE_URL });
    expect(m).toMatchObject({ versionId: "ver_baseline", parentVersionId: null, patchIds: [], status: "verified", method: FIGMA_METHOD, frameUrl: PAGE_URL });
    expect(m.frames).toHaveLength(8);
    expect(FigmaReference.parse(m)).toEqual({ frameUrl: PAGE_URL, status: "verified", manifestHash: m.manifestHash, patchIds: [] });
  });

  it("verifies a candidate against its parent's frames and carries its patch IDs and hash", async () => {
    const b = await writeCandidateB();
    const m = buildFigmaMapping({
      manifest: await readVersion(dir, "ver_b"),
      parent: { manifest: await readVersion(dir, "ver_baseline"), snapshot: snapshot() },
      snapshot: variantSnapshot(),
      frameUrl: "https://www.figma.com/design/x?node-id=60-1",
    });
    expect(m).toMatchObject({ versionId: "ver_b", parentVersionId: "ver_baseline", patchIds: ["pat_figmatest"], manifestHash: b.manifestHash, status: "verified" });
    expect(m.frames).toEqual([{ screen: "plan", nodeId: "60:1", name: "plan · ver_b" }]);
  });

  it("refuses a candidate without its parent", async () => {
    await writeCandidateB();
    const manifest = await readVersion(dir, "ver_b");
    expect(() => buildFigmaMapping({ manifest, snapshot: variantSnapshot(), frameUrl: "u" })).toThrow(/pass the parent/);
  });
});

describe("GET /api/figma/:versionId", () => {
  const get = (id: string) => fetch(`${baseUrl}/api/figma/${id}`);

  it("returns pending when a known version has no mapping", async () => {
    const res = await get("ver_baseline");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ versionId: "ver_baseline", status: "pending" });
  });

  it("returns the mapping once written", async () => {
    const mapping = buildFigmaMapping({ manifest: await readVersion(dir, "ver_baseline"), snapshot: snapshot(), frameUrl: PAGE_URL });
    await writeFigmaMapping(dir, mapping);
    const res = await get("ver_baseline");
    expect(res.status).toBe(200);
    expect(FigmaMapping.parse(await res.json())).toEqual(mapping);
  });

  it("404s an unknown version and 400s a malformed ID", async () => {
    expect((await get("ver_unknown")).status).toBe(404);
    expect(await (await get("ver_unknown")).json()).toEqual({ error: "version_not_found" });
    expect((await get("not_a_version")).status).toBe(400);
  });

  it("500s a corrupt or mismatched mapping file", async () => {
    await mkdir(path.join(dir, "figma"));
    await writeFile(path.join(dir, "figma", "ver_baseline.json"), "{nope");
    expect((await get("ver_baseline")).status).toBe(500);
    await writeFile(path.join(dir, "figma", "ver_baseline.json"), JSON.stringify({ versionId: "ver_other", status: "verified" }));
    expect(await (await get("ver_baseline")).json()).toEqual({ error: "figma/ver_baseline.json is not a Figma mapping for ver_baseline" });
  });

  it("rejects other methods and passes other URLs through", async () => {
    expect((await fetch(`${baseUrl}/api/figma/ver_baseline`, { method: "POST" })).status).toBe(405);
    expect((await fetch(`${baseUrl}/api/other`)).status).toBe(404);
  });
});
