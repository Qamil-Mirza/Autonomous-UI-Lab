import type { MutationPatch } from "@ghostloop/contracts";
import { ImportError } from "./errors";
import { jsxRenderedText, type ImportedManifest } from "./manifest";
import { sha256 } from "./task";

export interface TextChange {
  patchId: string;
  elementId: string;
  file: string;
  line: number;
  before: string;
  after: string;
}

const reject = (patchId: string, why: string) =>
  new ImportError("PATCH_REJECTED", `Patch ${patchId} was not applied: ${why}`, "Only approved wording changes to uniquely identified text can be applied to an imported app.");

/** New visible text must stay plain JSX text: one line, no markup, braces or entities. */
export function checkLabelValue(value: string): string | undefined {
  const v = value.trim();
  if (!v) return "the new text is empty";
  if (v.length > 200) return "the new text is longer than 200 characters";
  if (/[\r\n]/.test(value)) return "the new text spans several lines";
  if (/[{}<>&]/.test(v)) return "the new text contains {, }, <, > or &, which would change markup rather than wording";
  return undefined;
}

/**
 * Applies approved `set_label` patches to one immutable source version, in memory. Every patch must target an
 * editable element of exactly this version, and the file must still hold exactly the text the manifest recorded;
 * anything else is rejected before any change is made. Returns the new file map (unchanged files are shared).
 */
export function applyLabelPatches(
  files: ReadonlyMap<string, Buffer>,
  manifest: ImportedManifest,
  patches: readonly MutationPatch[],
  opts: { protectedElementIds?: ReadonlySet<string> } = {},
): { files: Map<string, Buffer>; changes: TextChange[] } {
  if (patches.length === 0) throw new ImportError("PATCH_REJECTED", "No approved patches to apply.");
  const byId = new Map(manifest.elements.map((e) => [e.elementId, e]));
  const targets = new Set<string>();
  const edits = new Map<string, { start: number; end: number; value: string }[]>();
  const changes: TextChange[] = [];
  for (const p of patches) {
    if (p.state !== "approved") throw reject(p.id, `it is ${p.state}, not approved by the designer`);
    if (p.risk === "blocked") throw reject(p.id, "it is blocked by policy");
    if (p.op !== "set_label") throw reject(p.id, `${p.op} is not supported for imported apps; only text label changes are`);
    if (p.sourceVersionId !== manifest.versionId) throw reject(p.id, `it was proposed for ${p.sourceVersionId}, not ${manifest.versionId}`);
    const el = byId.get(p.targetElementId);
    if (!el) throw reject(p.id, `element ${p.targetElementId} does not exist in ${manifest.versionId}`);
    if (el.protected || opts.protectedElementIds?.has(el.elementId)) throw reject(p.id, `${el.elementId} (“${el.label}”) is protected`);
    if (!el.supportedOps.includes("set_label")) throw reject(p.id, `${el.elementId} is not editable${el.note ? `: ${el.note}` : ""}`);
    if (targets.has(el.elementId)) throw reject(p.id, `another approved patch also changes ${el.elementId}`);
    targets.add(el.elementId);
    const bad = checkLabelValue(p.value);
    if (bad) throw reject(p.id, bad);
    const buf = files.get(el.source.file);
    if (!buf) throw reject(p.id, `${el.source.file} is missing from the source version`);
    if (sha256(buf) !== el.source.fileSha256) throw reject(p.id, `${el.source.file} differs from the version the manifest describes`);
    const text = buf.toString("utf8");
    if (text.slice(el.source.start, el.source.end) !== el.source.raw) throw reject(p.id, `the text at ${el.source.file}:${el.source.line} no longer matches`);
    const value = p.value.trim();
    if (value === el.label) throw reject(p.id, "the new text is the same as the current text");
    const list = edits.get(el.source.file) ?? [];
    list.push({ start: el.source.start, end: el.source.end, value });
    edits.set(el.source.file, list);
    changes.push({ patchId: p.id, elementId: el.elementId, file: el.source.file, line: el.source.line, before: jsxRenderedText(el.source.raw), after: value });
  }
  const out = new Map(files);
  for (const [file, list] of edits) {
    let text = files.get(file)!.toString("utf8");
    for (const e of [...list].sort((a, b) => b.start - a.start)) text = text.slice(0, e.start) + e.value + text.slice(e.end);
    out.set(file, Buffer.from(text, "utf8"));
  }
  return { files: out, changes };
}

/**
 * Guardrail: compares a stored candidate with what its approved patches alone produce from the parent. Every file
 * must be byte-identical to that expectation, and every parent element must survive with its old label or, for
 * the approved targets only, the approved new one.
 */
export function diffAgainstParent(args: {
  /** The parent's files with the approved patches re-applied (`applyLabelPatches`). */
  expectedFiles: ReadonlyMap<string, Buffer>;
  candidateFiles: ReadonlyMap<string, Buffer>;
  parent: ImportedManifest;
  candidate: ImportedManifest;
  changes: readonly TextChange[];
}): string[] {
  const problems: string[] = [];
  const allPaths = new Set([...args.expectedFiles.keys(), ...args.candidateFiles.keys()]);
  for (const path of [...allPaths].sort()) {
    const a = args.expectedFiles.get(path);
    const b = args.candidateFiles.get(path);
    if (!a) problems.push(`added file ${path}`);
    else if (!b) problems.push(`removed file ${path}`);
    else if (!a.equals(b)) problems.push(`unapproved change in ${path}`);
  }
  const changed = new Map(args.changes.map((c) => [c.elementId, c.after]));
  const cand = new Map(args.candidate.elements.map((e) => [e.elementId, e]));
  if (cand.size !== args.parent.elements.length) problems.push(`element count changed from ${args.parent.elements.length} to ${cand.size}`);
  for (const el of args.parent.elements) {
    const now = cand.get(el.elementId);
    if (!now) {
      problems.push(`element ${el.elementId} disappeared`);
      continue;
    }
    const expected = changed.get(el.elementId) ?? el.label;
    if (now.label !== expected) problems.push(`${el.elementId} reads “${now.label}”, expected “${expected}”`);
  }
  return problems;
}
