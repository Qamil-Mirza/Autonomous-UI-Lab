import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  CandidateDesign,
  MutationPatch,
  SCHEMA_VERSION,
  ValidationResult,
  newId,
  type CandidateAdapter,
  type CandidateId,
  type DesignManifest,
  type ValidationCheck,
  type VersionId,
} from "@ghostloop/contracts";
import { parseManifest, StyleToken, type PresentedManifest } from "@ghostloop/design-engine";
import { applyPatches, computeManifestHash } from "@ghostloop/design-engine/patch";
import { runBrowserChecks } from "./browser-checks";
import { evaluateGoal, GOAL_CHECKS } from "./check-goal";
import { CANDIDATE_ID, defaultDesignsDir, VERSION_ID } from "./designs";
import { emptyRunState, type RunState } from "./state";

// What designs/candidates/<cand_id>.json holds: the candidate plus the exact patches and parent it was built from.
export const CandidateRecord = z.object({
  candidate: CandidateDesign,
  patches: z.array(MutationPatch),
  parentManifestHash: z.string().min(1),
});
export type CandidateRecord = z.infer<typeof CandidateRecord>;

export interface CandidateAdapterOptions {
  // Where the prototype is served, e.g. "http://localhost:5173". Used for candidate URLs and the browser checks.
  baseUrl: string;
  // Defaults to GHOSTLOOP_DESIGNS_DIR, then <repo>/designs. Must be the directory the prototype server serves.
  designsDir?: string;
  // ID generators, for tests.
  newVersionId?: () => VersionId;
  newCandidateId?: () => CandidateId;
}

const PINNED_GOAL_CHECKS = ["account_created", "exactly_one_workspace", "free_plan_selected", "invite_sent", "no_paid_trial"];
const PRESENTED_FIELDS = ["screen", "role", "label", "visible", "order", "styleToken", "protected", "categories", "supportedOps"] as const;

const show = (v: unknown) => (v === undefined ? "unset" : JSON.stringify(v));
type RawElement = Record<string, unknown> & { elementId?: unknown };

export function createCandidateAdapter(options: CandidateAdapterOptions): CandidateAdapter {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const designsDir = path.resolve(options.designsDir ?? defaultDesignsDir());
  const versionFile = (id: string) => path.join(designsDir, "versions", `${id}.json`);
  const candidateFile = (id: string) => path.join(designsDir, "candidates", `${id}.json`);

  const assertId = (id: string, pattern: RegExp, what: string) => {
    if (!pattern.test(id)) throw new Error(`invalid ${what} ${JSON.stringify(id)}: must match ${pattern.source}`);
  };

  async function readJson(file: string, what: string): Promise<unknown> {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`${what} not found (${file})`);
      throw err;
    }
    return JSON.parse(text);
  }

  async function getManifest(versionId: VersionId): Promise<PresentedManifest> {
    assertId(versionId, VERSION_ID, "versionId");
    const manifest = parseManifest(await readJson(versionFile(versionId), `design version ${versionId}`));
    if (manifest.versionId !== versionId) throw new Error(`versions/${versionId}.json declares versionId ${manifest.versionId}`);
    return manifest;
  }

  async function readRecord(candidateId: string): Promise<CandidateRecord> {
    assertId(candidateId, CANDIDATE_ID, "candidateId");
    return CandidateRecord.parse(await readJson(candidateFile(candidateId), `candidate ${candidateId}`));
  }

  return {
    // The presented manifest is a contract DesignManifest plus presentation fields (styleToken, order, visible, patchIds).
    getManifest: (versionId): Promise<DesignManifest> => getManifest(versionId),

    async createCandidate(sourceVersionId, approvedPatches) {
      const source = await getManifest(sourceVersionId);
      // Throws PatchError for any invalid patch, before anything is written.
      const manifest = applyPatches(source, approvedPatches, options.newVersionId ? { newVersionId: options.newVersionId } : {});
      const candidate = CandidateDesign.parse({
        schemaVersion: SCHEMA_VERSION,
        id: (options.newCandidateId ?? (() => newId("cand")))(),
        versionId: manifest.versionId,
        parentVersionId: sourceVersionId,
        patchIds: approvedPatches.map((p) => p.id),
        url: `${baseUrl}/v/${manifest.versionId}/signup`,
        reviewStatus: "pending",
        createdAt: new Date().toISOString(),
      });
      const record: CandidateRecord = { candidate, patches: approvedPatches.map((p) => MutationPatch.parse(p)), parentManifestHash: source.manifestHash };

      // Exclusive create ("wx"): an existing version or candidate file is never overwritten.
      await mkdir(path.dirname(versionFile(manifest.versionId)), { recursive: true });
      await mkdir(path.dirname(candidateFile(candidate.id)), { recursive: true });
      await writeFile(versionFile(manifest.versionId), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
      try {
        await writeFile(candidateFile(candidate.id), JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
      } catch (err) {
        await rm(versionFile(manifest.versionId), { force: true });
        throw err;
      }
      return candidate;
    },

    async validateCandidate(candidateId) {
      const { candidate } = await readRecord(candidateId);
      const checks: ValidationCheck[] = [];
      const pass = (name: string, kind: ValidationCheck["kind"], detail?: string): ValidationCheck =>
        detail === undefined ? { name, kind, passed: true } : { name, kind, passed: true, detail };
      const fail = (name: string, kind: ValidationCheck["kind"], detail: string): ValidationCheck => ({ name, kind, passed: false, detail });

      // Raw file contents, so guardrails still report factually when the file no longer parses.
      let raw: { elements?: unknown } | null = null;
      let rawError = "";
      try {
        raw = (await readJson(versionFile(candidate.versionId), `design version ${candidate.versionId}`)) as { elements?: unknown };
      } catch (err) {
        rawError = err instanceof Error ? err.message : String(err);
      }
      const rawElements: RawElement[] = Array.isArray(raw?.elements) ? (raw.elements as RawElement[]) : [];

      // build
      let manifest: PresentedManifest | null = null;
      try {
        if (!raw) throw new Error(rawError);
        manifest = parseManifest(raw);
        const problems = [
          manifest.versionId !== candidate.versionId && `versionId is ${manifest.versionId}, expected ${candidate.versionId}`,
          manifest.parentVersionId !== candidate.parentVersionId && `parentVersionId is ${show(manifest.parentVersionId)}, expected ${candidate.parentVersionId}`,
          manifest.manifestHash !== computeManifestHash(manifest.elements) && "manifestHash does not match its elements",
        ].filter((p): p is string => typeof p === "string");
        checks.push(problems.length === 0 ? pass("build", "runnable", `${candidate.versionId} parses against the contract and presented schemas`) : fail("build", "runnable", problems.join("; ")));
      } catch (err) {
        manifest = null;
        checks.push(fail("build", "runnable", `manifest does not parse: ${(err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").slice(0, 400)}`));
      }

      // Browser checks need a parsed manifest; without one they cannot run.
      const browser = manifest
        ? await runBrowserChecks({ baseUrl, versionId: candidate.versionId, elements: manifest.elements, label: candidateId.replace(/^cand_/, "") })
        : null;
      const notBuilt = "skipped: candidate manifest did not build";
      checks.push(browser?.renders ?? fail("renders_all_screens", "runnable", notBuilt));
      checks.push(browser?.smoke ?? fail("onboarding_smoke", "runnable", notBuilt));

      // Guardrails compare against the parent version.
      let parent: PresentedManifest | null = null;
      let parentError = "";
      try {
        parent = await getManifest(candidate.parentVersionId);
      } catch (err) {
        parentError = `parent ${candidate.parentVersionId} unavailable: ${err instanceof Error ? err.message : String(err)}`;
      }
      const rawById = new Map(rawElements.map((e) => [String(e.elementId), e]));

      if (!parent) {
        checks.push(fail("protected_elements_unchanged", "guardrail", parentError));
        checks.push(fail("manifest_ids_stable", "guardrail", parentError));
      } else {
        const changes: string[] = [];
        for (const el of parent.elements.filter((e) => e.protected)) {
          const now = rawById.get(el.elementId);
          if (!now) {
            changes.push(`${el.elementId} was removed`);
            continue;
          }
          for (const field of PRESENTED_FIELDS) {
            const before = (el as Record<string, unknown>)[field];
            if (JSON.stringify(before) !== JSON.stringify(now[field])) changes.push(`${el.elementId} ${field} changed from ${show(before)} to ${show(now[field])}`);
          }
        }
        const protectedCount = parent.elements.filter((e) => e.protected).length;
        checks.push(changes.length === 0 ? pass("protected_elements_unchanged", "guardrail", `${protectedCount} protected elements identical to ${parent.versionId}`) : fail("protected_elements_unchanged", "guardrail", changes.join("; ")));

        const parentIds = new Set(parent.elements.map((e) => e.elementId));
        const added = [...rawById.keys()].filter((id) => !parentIds.has(id));
        const removed = [...parentIds].filter((id) => !rawById.has(id));
        checks.push(
          added.length + removed.length === 0 && rawById.size === rawElements.length
            ? pass("manifest_ids_stable", "guardrail", `same ${parentIds.size} element IDs as ${parent.versionId}`)
            : fail("manifest_ids_stable", "guardrail", [added.length && `added: ${added.join(", ")}`, removed.length && `removed: ${removed.join(", ")}`, rawById.size !== rawElements.length && "duplicate element IDs"].filter(Boolean).join("; ")),
        );
      }

      checks.push(checkerUnchanged(parent, rawById));

      const badTokens = rawElements.filter((e) => e.styleToken !== undefined && !StyleToken.safeParse(e.styleToken).success).map((e) => `${String(e.elementId)}: ${show(e.styleToken)}`);
      const tokenCount = rawElements.filter((e) => e.styleToken !== undefined).length;
      checks.push(badTokens.length === 0 ? pass("style_tokens_approved", "guardrail", `${tokenCount} style tokens, all approved`) : fail("style_tokens_approved", "guardrail", `unapproved style tokens: ${badTokens.join(", ")}`));

      checks.push(browser?.accessible ?? fail("accessible_labels", "guardrail", notBuilt));

      return ValidationResult.parse({
        schemaVersion: SCHEMA_VERSION,
        id: newId("val"),
        candidateId,
        ok: checks.every((c) => c.passed),
        checks,
        at: new Date().toISOString(),
      });
    },
  };
}

// The goal checker reads only run state, never a manifest. This canary pins its check list and its verdicts on
// reference states, and confirms no element in the "checker" category changed.
function checkerUnchanged(parent: PresentedManifest | null, rawById: Map<string, RawElement>): ValidationCheck {
  const problems: string[] = [];
  if (JSON.stringify(GOAL_CHECKS) !== JSON.stringify(PINNED_GOAL_CHECKS)) problems.push(`goal checks are ${GOAL_CHECKS.join(", ")}`);

  const at = "2026-01-01T00:00:00.000Z";
  const workspace = { id: "ws_canary", name: "Northwind", createdAt: at, updatedAt: at };
  const complete: RunState = {
    ...emptyRunState("run_canary", at),
    account: { name: "Alex Kim", email: "alex@northwind.test", consent: true, passwordLength: 12 },
    workspaces: [workspace],
    plan: "free",
    invites: [{ email: "jordan@northwind.test", status: "sent", at }],
  };
  const cases: [string, RunState, string[]][] = [
    ["free path", complete, []],
    ["pro trial", { ...complete, plan: "pro", paidTrialStarted: true }, ["free_plan_selected", "no_paid_trial"]],
    ["two workspaces", { ...complete, workspaces: [workspace, { ...workspace, id: "ws_canary2" }] }, ["exactly_one_workspace"]],
    ["no invite", { ...complete, invites: [] }, ["invite_sent"]],
  ];
  for (const [name, state, expectedFailing] of cases) {
    const failing = evaluateGoal(state).checks.filter((c) => !c.passed).map((c) => c.name);
    if (failing.join() !== expectedFailing.join()) problems.push(`${name}: expected failing [${expectedFailing.join(", ")}], got [${failing.join(", ")}]`);
  }

  for (const el of parent?.elements.filter((e) => e.categories.includes("checker")) ?? []) {
    if (JSON.stringify(el) !== JSON.stringify(rawById.get(el.elementId))) problems.push(`checker element ${el.elementId} changed`);
  }

  return problems.length === 0
    ? { name: "checker_unchanged", kind: "guardrail", passed: true, detail: `${cases.length} reference states give the pinned verdicts` }
    : { name: "checker_unchanged", kind: "guardrail", passed: false, detail: problems.join("; ") };
}
