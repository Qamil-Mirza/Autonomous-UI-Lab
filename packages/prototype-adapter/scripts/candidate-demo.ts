// Creates two candidates from ver_baseline against a running prototype, validates both, and proves the baseline
// file is untouched. Usage: npm run dev -w @ghostloop/prototype, then npm run candidate:demo -w @ghostloop/prototype-adapter
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { newId, SCHEMA_VERSION, type CandidateDesign, type MutationPatch, type ValidationResult } from "@ghostloop/contracts";
import { createCandidateAdapter, defaultDesignsDir } from "../src";

const baseUrl = process.env.GHOSTLOOP_BASE_URL ?? "http://localhost:5173";
const designsDir = defaultDesignsDir();
const baselineFile = path.join(designsDir, "versions", "ver_baseline.json");

try {
  await fetch(baseUrl, { signal: AbortSignal.timeout(3_000) });
} catch {
  console.error(`No prototype server at ${baseUrl}. Start it with: npm run dev -w @ghostloop/prototype (or set GHOSTLOOP_BASE_URL).`);
  process.exit(1);
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const baselineBefore = await readFile(baselineFile);

const experimentId = "exp_demo";
const approved = (targetElementId: string, op: MutationPatch["op"], value: string | boolean, rationale: string): MutationPatch =>
  ({
    schemaVersion: SCHEMA_VERSION,
    id: newId("pat"),
    experimentId,
    round: 1,
    sourceVersionId: "ver_baseline",
    targetElementId,
    op,
    value,
    observationIds: ["obs_demo"],
    rationale,
    risk: "review_required",
    state: "approved",
  }) as MutationPatch;

const label = approved("plan.free.cta", "set_label", "Continue with Free plan", "Free and Pro options may be insufficiently differentiated.");
const note = approved("plan.free.note", "set_visibility", true, "Show that the Free plan needs no card.");

const adapter = createCandidateAdapter({ baseUrl, designsDir });

function printCandidate(title: string, c: CandidateDesign, v: ValidationResult) {
  console.log(`\n=== ${title} ===`);
  console.log(JSON.stringify(c, null, 2));
  console.log(`URL: ${c.url}`);
  console.log(`Validation ${v.id}: ${v.ok ? "OK" : "FAILED"}`);
  for (const ch of v.checks) console.log(`  ${ch.passed ? "✓" : "✗"} ${ch.name.padEnd(29)} ${ch.kind.padEnd(9)} ${ch.detail ?? ""}`);
}

console.log(`Prototype: ${baseUrl}`);
console.log(`Designs:   ${designsDir}`);
console.log(`Patches:   ${label.id} set_label plan.free.cta → "Continue with Free plan"`);
console.log(`           ${note.id} set_visibility plan.free.note → true`);

const b = await adapter.createCandidate("ver_baseline", [label]);
const c = await adapter.createCandidate("ver_baseline", [label, note]);
const [vb, vc] = await Promise.all([adapter.validateCandidate(b.id), adapter.validateCandidate(c.id)]);
printCandidate(`Candidate B: ${label.id} only`, b, vb);
printCandidate(`Candidate C: ${label.id} + ${note.id}`, c, vc);

const baselineAfter = await readFile(baselineFile);
const identical = baselineAfter.equals(baselineBefore);
console.log(`\nver_baseline.json byte-identical: ${identical ? "yes" : "NO"} (sha256 ${sha256(baselineBefore)} → ${sha256(baselineAfter)})`);
console.log(`Baseline URL: ${baseUrl}/v/ver_baseline/signup`);
process.exit(identical && vb.ok && vc.ok ? 0 : 1);
