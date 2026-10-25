import { describe, expect, it, vi } from "vitest";
import type { BatchRequest, CandidateAdapter, MutationPatch, SimulationAdapter } from "@ghostloop/contracts";
import { dispatchCandidates, dispatchSimulation, type ImportedOwnership } from "../src/imported";

const owns: ImportedOwnership = {
  ownsVersion: async (v) => v.startsWith("ver_imp_"),
  ownsCandidate: async (c) => c === "cand_imported",
};

const sim = (name: string) => ({ runBatch: vi.fn(async () => ({ name }) as never) }) satisfies SimulationAdapter;
const cands = (name: string) =>
  ({
    getManifest: vi.fn(async () => ({ name }) as never),
    createCandidate: vi.fn(async () => ({ name }) as never),
    validateCandidate: vi.fn(async () => ({ name }) as never),
  }) satisfies CandidateAdapter;

const req = (versionId: string) => ({ versionId }) as BatchRequest;

describe("imported-app dispatch", () => {
  it("sends imported versions to the imported simulator and the rest to the existing one", async () => {
    const imported = sim("imported");
    const onboarding = sim("onboarding");
    const d = dispatchSimulation(owns, imported, onboarding);
    const signal = new AbortController().signal;
    expect(await d.runBatch(req("ver_imp_aaaaaaaaaaaa"), () => {}, signal)).toEqual({ name: "imported" });
    expect(await d.runBatch(req("ver_baseline"), () => {}, signal)).toEqual({ name: "onboarding" });
    expect(imported.runBatch).toHaveBeenCalledTimes(1);
    expect(onboarding.runBatch).toHaveBeenCalledTimes(1);
  });

  it("routes manifests, candidate creation and validation by ownership", async () => {
    const imported = cands("imported");
    const onboarding = cands("onboarding");
    const d = dispatchCandidates(owns, imported, onboarding);
    expect(await d.getManifest("ver_imp_aaaaaaaaaaaa" as never)).toEqual({ name: "imported" });
    expect(await d.getManifest("ver_baseline" as never)).toEqual({ name: "onboarding" });
    expect(await d.createCandidate("ver_imp_aaaaaaaaaaaa" as never, [] as MutationPatch[])).toEqual({ name: "imported" });
    expect(await d.createCandidate("ver_baseline" as never, [] as MutationPatch[])).toEqual({ name: "onboarding" });
    expect(await d.validateCandidate("cand_imported" as never)).toEqual({ name: "imported" });
    expect(await d.validateCandidate("cand_other" as never)).toEqual({ name: "onboarding" });
  });
});
