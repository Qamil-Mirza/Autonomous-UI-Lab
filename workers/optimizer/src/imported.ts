import path from "node:path";
import type { CandidateAdapter, SimulationAdapter } from "@ghostloop/contracts";
import { ImportService } from "@ghostloop/importer";
import { createSimulationAdapter } from "@ghostloop/simulator";
import { DEFAULT_ARTIFACTS_DIR, REPO_ROOT, screenshotPublisher } from "./real-adapters";

/** What the dispatchers need to know about imported versions and candidates. */
export interface ImportedOwnership {
  ownsVersion(versionId: string): Promise<boolean>;
  ownsCandidate(candidateId: string): Promise<boolean>;
}

/**
 * Sends batches on imported versions to the imported-app simulator and everything else (the onboarding prototype,
 * or its mocks) to `other`. Imported versions never fall back to a mock: their results are always real.
 */
export function dispatchSimulation(owns: ImportedOwnership, imported: SimulationAdapter, other: SimulationAdapter): SimulationAdapter {
  return {
    async runBatch(req, onEvent, signal) {
      return ((await owns.ownsVersion(req.versionId)) ? imported : other).runBatch(req, onEvent, signal);
    },
  };
}

/** Routes candidate work by who owns the source version or candidate; onboarding candidates are unchanged. */
export function dispatchCandidates(owns: ImportedOwnership, imported: CandidateAdapter, other: CandidateAdapter): CandidateAdapter {
  return {
    async getManifest(versionId) {
      return ((await owns.ownsVersion(versionId)) ? imported : other).getManifest(versionId);
    },
    async createCandidate(sourceVersionId, patches) {
      return ((await owns.ownsVersion(sourceVersionId)) ? imported : other).createCandidate(sourceVersionId, patches);
    },
    async validateCandidate(candidateId) {
      return ((await owns.ownsCandidate(candidateId)) ? imported : other).validateCandidate(candidateId);
    },
  };
}

export const DEFAULT_IMPORTS_DIR = path.join(REPO_ROOT, ".ghostloop/imports");

/** The import service plus its live adapters: Bitdeer decides actions, the frozen page checks decide success. */
export function createImports(opts: { root?: string; artifactsDir?: string; log?: (line: string) => void } = {}) {
  const artifactsDir = opts.artifactsDir ?? DEFAULT_ARTIFACTS_DIR;
  const publishScreenshot = screenshotPublisher(artifactsDir);
  const service = new ImportService({ root: opts.root ?? DEFAULT_IMPORTS_DIR, artifactsDir, publishScreenshot, log: opts.log });
  const simulation = createSimulationAdapter({
    outputDir: path.join(artifactsDir, "batches"),
    provenance: "live-bitdeer",
    publishScreenshot,
    // No judge: imported trials are decided only by GhostLoop's frozen checks.
    integration: (req) => service.integrationFor(req),
  });
  const ownership: ImportedOwnership = {
    ownsVersion: (v) => service.ownsVersion(v),
    ownsCandidate: async (c) => (await service.store.getCandidate(c)) !== undefined,
  };
  return { service, simulation, candidates: service.candidateAdapter(), ownership };
}
export type Imports = ReturnType<typeof createImports>;
