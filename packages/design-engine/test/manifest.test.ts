import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DesignManifest } from "@ghostloop/contracts";
import { parseManifest } from "../src";

const baselinePath = new URL("../../../designs/versions/ver_baseline.json", import.meta.url);
const baseline = (): any => JSON.parse(readFileSync(baselinePath, "utf8"));

describe("baseline manifest", () => {
  it("validates against the contract and the presentation schema", () => {
    expect(DesignManifest.safeParse(baseline()).success).toBe(true);
    expect(parseManifest(baseline()).versionId).toBe("ver_baseline");
  });

  it("hides plan.free.note", () => {
    const el = parseManifest(baseline()).elements.find((e) => e.elementId === "plan.free.note");
    expect(el?.visible).toBe(false);
  });

  it("protects signup, pricing and validation elements with the expected categories", () => {
    const byId = new Map(parseManifest(baseline()).elements.map((e) => [e.elementId, e]));
    const expected: Record<string, string[]> = {
      "signup.name": ["signup"],
      "signup.name.error": ["signup"],
      "signup.email": ["signup"],
      "signup.email.error": ["signup"],
      "signup.password": ["auth"],
      "signup.password.error": ["auth"],
      "signup.consent": ["consent"],
      "signup.consent.error": ["consent"],
      "signup.submit": ["signup"],
      "workspace.name.error": ["validation"],
      "plan.free.price": ["pricing"],
      "plan.pro.price": ["pricing"],
      "plan.pro.note": ["pricing"],
      "invite.email": ["validation"],
      "invite.error": ["validation"],
    };
    for (const [id, categories] of Object.entries(expected)) {
      const el = byId.get(id);
      expect(el?.protected, id).toBe(true);
      expect(el?.categories, id).toEqual(categories);
      expect(el?.supportedOps, id).toEqual([]);
    }
  });

  it("leaves back links unprotected and label-only", () => {
    const byId = new Map(parseManifest(baseline()).elements.map((e) => [e.elementId, e]));
    for (const id of ["workspace.back", "plan.back", "invite.back"]) {
      expect(byId.get(id)?.protected, id).toBe(false);
      expect(byId.get(id)?.supportedOps, id).toEqual(["set_label"]);
    }
  });
});

describe("parseManifest", () => {
  it("rejects a style token outside the allowlist", () => {
    const m = baseline();
    m.elements[0].styleToken = "button.neon";
    expect(() => parseManifest(m)).toThrow();
  });

  it("rejects duplicate elementIds via the contract", () => {
    const m = baseline();
    m.elements.push({ ...m.elements[0] });
    expect(() => parseManifest(m)).toThrow(/duplicate elementId/);
  });
});
