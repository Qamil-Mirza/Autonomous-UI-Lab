import {
  DesignManifest,
  SCHEMA_VERSION,
  ValidationResult,
  newId,
  type CandidateAdapter,
  type CandidateDesign,
} from "@ghostloop/contracts";
import { loadFixture } from "@ghostloop/contracts/fixtures";

export interface MockCandidatesOptions {
  validation?: "pass" | "fail_runnable" | "fail_guardrail";
  throwOn?: "create" | "validate";
}

export type MockCandidates = CandidateAdapter & { created: { sourceVersionId: string; patchIds: string[] }[] };

/** MOCK C: every version shares the base manifest; candidates get fresh `cand_`/`ver_` IDs. */
export function createMockCandidates(opts: MockCandidatesOptions = {}): MockCandidates {
  const mode = opts.validation ?? "pass";
  const mock: MockCandidates = {
    created: [],
    async getManifest(versionId) {
      const m = loadFixture("manifest.base.json", DesignManifest);
      return m.versionId === versionId ? m : { ...m, versionId, manifestHash: `sha256:mock-${versionId}` };
    },
    async createCandidate(sourceVersionId, approvedPatches) {
      if (opts.throwOn === "create") throw new Error("mock candidate creation failure");
      const patchIds = approvedPatches.map((p) => p.id);
      mock.created.push({ sourceVersionId, patchIds });
      const versionId = newId("ver");
      const c: CandidateDesign = {
        schemaVersion: SCHEMA_VERSION,
        id: newId("cand"),
        versionId,
        parentVersionId: sourceVersionId,
        patchIds,
        url: `http://localhost:5173/v/${versionId}`,
        reviewStatus: "pending",
        createdAt: new Date().toISOString(),
      };
      return c;
    },
    async validateCandidate(candidateId) {
      if (opts.throwOn === "validate") throw new Error("mock validation failure");
      const v = loadFixture(mode === "fail_guardrail" ? "validation.fail.json" : "validation.pass.json", ValidationResult);
      const out: ValidationResult = { ...v, candidateId, at: new Date().toISOString() };
      if (mode === "fail_runnable") {
        out.ok = false;
        out.checks = out.checks.map((c) => (c.name === "build" ? { ...c, passed: false, detail: "mock build failed" } : c));
      }
      return out;
    },
  };
  return mock;
}
