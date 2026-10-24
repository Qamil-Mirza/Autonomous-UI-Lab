import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CandidateDesign, ValidationResult, type MutationPatch } from "@ghostloop/contracts";
import { computeManifestHash, PatchError } from "@ghostloop/design-engine/patch";
import { createCandidateAdapter } from "../src";

const BASELINE = new URL("../../../designs/versions/ver_baseline.json", import.meta.url);
// Nothing listens here, so the browser checks fail fast with a clear reason and the guardrails still run.
const UNREACHABLE = "http://127.0.0.1:9";

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ghostloop-designs-"));
  await mkdir(path.join(dir, "versions"));
  await copyFile(BASELINE, path.join(dir, "versions", "ver_baseline.json"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function patch(id: string, targetElementId: string, op: MutationPatch["op"], value: unknown): MutationPatch {
  return {
    schemaVersion: "1.0.0",
    id,
    experimentId: "exp_test",
    round: 1,
    sourceVersionId: "ver_baseline",
    targetElementId,
    op,
    value,
    observationIds: ["obs_1"],
    rationale: "test",
    risk: "review_required",
    state: "approved",
  } as MutationPatch;
}

const LABEL = patch("pat_label", "plan.free.cta", "set_label", "Continue with Free plan");
const NOTE = patch("pat_note", "plan.free.note", "set_visibility", true);

const versionPath = (id: string) => path.join(dir, "versions", `${id}.json`);
const readVersion = async (id: string) => JSON.parse(await readFile(versionPath(id), "utf8"));
const el = (m: { elements: { elementId: string }[] }, id: string) => m.elements.find((e) => e.elementId === id) as Record<string, unknown>;

describe("createCandidate", () => {
  it("returns a contract-valid candidate and writes its version and record", async () => {
    const adapter = createCandidateAdapter({ baseUrl: "http://localhost:5173/", designsDir: dir });
    const c = await adapter.createCandidate("ver_baseline", [LABEL]);
    expect(CandidateDesign.safeParse(c).success).toBe(true);
    expect(c.patchIds).toEqual(["pat_label"]);
    expect(c.parentVersionId).toBe("ver_baseline");
    expect(c.reviewStatus).toBe("pending");
    expect(c.figma).toBeUndefined();
    expect(c.url).toBe(`http://localhost:5173/v/${c.versionId}/signup`);

    const m = await readVersion(c.versionId);
    expect(m.versionId).toBe(c.versionId);
    expect(m.parentVersionId).toBe("ver_baseline");
    expect(m.patchIds).toEqual(["pat_label"]);
    expect(el(m, "plan.free.cta").label).toBe("Continue with Free plan");
    const record = JSON.parse(await readFile(path.join(dir, "candidates", `${c.id}.json`), "utf8"));
    expect(record.candidate).toEqual(c);
    expect(record.patches.map((p: MutationPatch) => p.id)).toEqual(["pat_label"]);
  });

  it("builds a selected subset as its own distinct candidate containing only those patches", async () => {
    const adapter = createCandidateAdapter({ baseUrl: UNREACHABLE, designsDir: dir });
    const both = await adapter.createCandidate("ver_baseline", [LABEL, NOTE]);
    const subset = await adapter.createCandidate("ver_baseline", [LABEL]);
    expect(subset.id).not.toBe(both.id);
    expect(subset.versionId).not.toBe(both.versionId);
    expect(subset.patchIds).toEqual(["pat_label"]);
    expect(both.patchIds).toEqual(["pat_label", "pat_note"]);

    const s = await readVersion(subset.versionId);
    const b = await readVersion(both.versionId);
    expect(el(s, "plan.free.cta").label).toBe("Continue with Free plan");
    expect(el(s, "plan.free.note").visible).toBe(false);
    expect(el(b, "plan.free.note").visible).toBe(true);
  });

  it("never changes the baseline file", async () => {
    const before = await readFile(versionPath("ver_baseline"));
    const adapter = createCandidateAdapter({ baseUrl: UNREACHABLE, designsDir: dir });
    await adapter.createCandidate("ver_baseline", [LABEL, NOTE]);
    await adapter.createCandidate("ver_baseline", [LABEL]);
    await expect(adapter.createCandidate("ver_baseline", [patch("pat_bad", "plan.free.price", "set_label", "Free")])).rejects.toThrow(PatchError);
    expect((await readFile(versionPath("ver_baseline"))).equals(before)).toBe(true);
  });

  it("gives two candidates from the same source different version IDs", async () => {
    const adapter = createCandidateAdapter({ baseUrl: UNREACHABLE, designsDir: dir });
    const a = await adapter.createCandidate("ver_baseline", [LABEL]);
    const b = await adapter.createCandidate("ver_baseline", [LABEL]);
    expect(a.versionId).not.toBe(b.versionId);
  });

  it("throws the PatchError and writes nothing when a patch is invalid", async () => {
    const adapter = createCandidateAdapter({ baseUrl: UNREACHABLE, designsDir: dir });
    await expect(adapter.createCandidate("ver_baseline", [LABEL, patch("pat_submit", "signup.submit", "set_label", "Go")])).rejects.toThrow(
      /signup\.submit is protected \(signup\)/,
    );
    expect(await readdir(path.join(dir, "versions"))).toEqual(["ver_baseline.json"]);
  });

  it("never overwrites an existing version file", async () => {
    await writeFile(versionPath("ver_taken"), "existing\n");
    const adapter = createCandidateAdapter({ baseUrl: UNREACHABLE, designsDir: dir, newVersionId: () => "ver_taken" });
    await expect(adapter.createCandidate("ver_baseline", [LABEL])).rejects.toThrow(/EEXIST/);
    expect(await readFile(versionPath("ver_taken"), "utf8")).toBe("existing\n");
  });

  it("removes the new version when the candidate record cannot be written", async () => {
    await mkdir(path.join(dir, "candidates"));
    await writeFile(path.join(dir, "candidates", "cand_taken.json"), "existing\n");
    const adapter = createCandidateAdapter({ baseUrl: UNREACHABLE, designsDir: dir, newVersionId: () => "ver_orphan", newCandidateId: () => "cand_taken" });
    await expect(adapter.createCandidate("ver_baseline", [LABEL])).rejects.toThrow(/EEXIST/);
    expect(await readdir(path.join(dir, "versions"))).toEqual(["ver_baseline.json"]);
  });
});

describe("getManifest", () => {
  it("returns the requested version", async () => {
    const adapter = createCandidateAdapter({ baseUrl: UNREACHABLE, designsDir: dir });
    expect((await adapter.getManifest("ver_baseline")).versionId).toBe("ver_baseline");
    const c = await adapter.createCandidate("ver_baseline", [LABEL]);
    const m = await adapter.getManifest(c.versionId);
    expect(m.versionId).toBe(c.versionId);
    expect(m.parentVersionId).toBe("ver_baseline");
  });

  it("throws for unknown or malformed version IDs", async () => {
    const adapter = createCandidateAdapter({ baseUrl: UNREACHABLE, designsDir: dir });
    await expect(adapter.getManifest("ver_missing")).rejects.toThrow(/design version ver_missing not found/);
    await expect(adapter.getManifest("ver_../../etc" as "ver_x")).rejects.toThrow(/invalid versionId/);
  });
});

describe("validateCandidate", () => {
  it("passes every guardrail on an untampered candidate and fails browser checks clearly when the server is down", async () => {
    const adapter = createCandidateAdapter({ baseUrl: UNREACHABLE, designsDir: dir });
    const c = await adapter.createCandidate("ver_baseline", [LABEL, NOTE]);
    const v = await adapter.validateCandidate(c.id);
    expect(ValidationResult.safeParse(v).success).toBe(true);
    expect(v.candidateId).toBe(c.id);
    expect(v.ok).toBe(false);
    const byName = Object.fromEntries(v.checks.map((ch) => [ch.name, ch]));
    expect(Object.keys(byName)).toEqual([
      "build",
      "renders_all_screens",
      "onboarding_smoke",
      "protected_elements_unchanged",
      "manifest_ids_stable",
      "checker_unchanged",
      "style_tokens_approved",
      "accessible_labels",
    ]);
    for (const name of ["build", "protected_elements_unchanged", "manifest_ids_stable", "checker_unchanged", "style_tokens_approved"]) {
      expect(byName[name]?.passed, name).toBe(true);
    }
    for (const name of ["renders_all_screens", "onboarding_smoke", "accessible_labels"]) {
      expect(byName[name]?.passed, name).toBe(false);
      expect(byName[name]?.detail, name).toMatch(/app server not reachable at http:\/\/127\.0\.0\.1:9/);
    }
  });

  it("fails protected_elements_unchanged when a protected element is tampered with on disk", async () => {
    const adapter = createCandidateAdapter({ baseUrl: UNREACHABLE, designsDir: dir });
    const c = await adapter.createCandidate("ver_baseline", [LABEL]);
    const m = await readVersion(c.versionId);
    el(m, "plan.free.price").label = "Free forever";
    // Keep the hash consistent so only the guardrail can catch it.
    m.manifestHash = computeManifestHash(m.elements);
    await writeFile(versionPath(c.versionId), JSON.stringify(m, null, 2));

    const v = await adapter.validateCandidate(c.id);
    const check = v.checks.find((ch) => ch.name === "protected_elements_unchanged");
    expect(v.ok).toBe(false);
    expect(check?.passed).toBe(false);
    expect(check?.detail).toBe('plan.free.price label changed from "$0 / month" to "Free forever"');
    expect(v.checks.find((ch) => ch.name === "build")?.passed).toBe(true);
  });

  it("reports unapproved style tokens, changed IDs and a broken build factually", async () => {
    const adapter = createCandidateAdapter({ baseUrl: UNREACHABLE, designsDir: dir });
    const c = await adapter.createCandidate("ver_baseline", [LABEL]);
    const m = await readVersion(c.versionId);
    el(m, "plan.free.cta").styleToken = "button.neon";
    m.elements = m.elements.filter((e: { elementId: string }) => e.elementId !== "plan.back");
    await writeFile(versionPath(c.versionId), JSON.stringify(m, null, 2));

    const v = await adapter.validateCandidate(c.id);
    const byName = Object.fromEntries(v.checks.map((ch) => [ch.name, ch]));
    expect(byName.build?.passed).toBe(false);
    expect(byName.style_tokens_approved?.detail).toBe('unapproved style tokens: plan.free.cta: "button.neon"');
    expect(byName.manifest_ids_stable?.detail).toBe("removed: plan.back");
    expect(byName.renders_all_screens?.detail).toBe("skipped: candidate manifest did not build");
  });

  it("throws for an unknown candidate", async () => {
    const adapter = createCandidateAdapter({ baseUrl: UNREACHABLE, designsDir: dir });
    await expect(adapter.validateCandidate("cand_missing")).rejects.toThrow(/candidate cand_missing not found/);
  });
});
