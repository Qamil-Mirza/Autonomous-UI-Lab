import ts from "typescript";
import { z } from "zod";
import { DesignManifest, ManifestElement, type MutationOp } from "@ghostloop/contracts";
import { canonicalJson, sha256, type ImportTask } from "./task";

/** Where an editable text lives in the source, pinned to the exact file contents it was read from. */
export const SourceLocation = z.object({
  file: z.string().min(1),
  /** Character offsets of the trimmed text inside the file. */
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  /** The raw source text between start and end. */
  raw: z.string(),
  fileSha256: z.string().length(64),
  /** The JSX tag the text sits in, e.g. "button" or "Button". */
  tag: z.string(),
});
export type SourceLocation = z.infer<typeof SourceLocation>;

export const ImportedElement = ManifestElement.extend({
  source: SourceLocation,
  /** Why the element cannot be edited, when `supportedOps` is empty or it is protected. */
  note: z.string().optional(),
});
export type ImportedElement = z.infer<typeof ImportedElement>;

export const ImportedManifest = z.object({
  schemaVersion: z.literal("1.0.0"),
  versionId: z.string().min(1),
  parentVersionId: z.string().min(1).optional(),
  manifestHash: z.string().min(1),
  sourceHash: z.string().length(64),
  elements: z.array(ImportedElement),
});
export type ImportedManifest = z.infer<typeof ImportedManifest>;

const MAX_TEXT = 200;
const MAX_FILE_BYTES = 400_000;
/** Generated UI primitives: their text is generic and shared by every screen. */
const EXCLUDED = /^src\/components\/ui\//;

/** Rendered text of a JSX text node, following React's whitespace rules (lines trimmed, joined by spaces). */
export function jsxRenderedText(raw: string): string {
  return raw
    .split(/\r?\n/)
    .map((l, i, all) => (i === 0 ? l.replace(/\s+$/, "") : i === all.length - 1 ? l.replace(/^\s+/, "") : l.trim()))
    .filter((l) => l.length > 0)
    .join(" ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

function roleOf(tag: string): string {
  const t = tag.toLowerCase();
  if (t === "button" || t.endsWith("button")) return "button";
  if (t === "a" || t === "link" || t.endsWith("link")) return "link";
  if (/^h[1-6]$/.test(t) || t.includes("title") || t.includes("heading")) return "heading";
  if (t === "label") return "label";
  if (t === "li" || t === "option" || t.endsWith("item")) return "item";
  return "text";
}

function tagName(node: ts.Node, sf: ts.SourceFile): string {
  const parent = node.parent;
  if (parent && ts.isJsxElement(parent)) return parent.openingElement.tagName.getText(sf);
  if (parent && ts.isJsxFragment(parent)) return "Fragment";
  return "unknown";
}

interface RawText {
  file: string;
  ordinal: number;
  text: string;
  loc: SourceLocation;
}

/** Every literal JSX text child in the app's `src/**.tsx|jsx`, in file and source order. */
export function findJsxTexts(files: ReadonlyMap<string, Buffer>): RawText[] {
  const out: RawText[] = [];
  const paths = [...files.keys()].filter((p) => /^src\/.+\.(tsx|jsx)$/.test(p) && !EXCLUDED.test(p)).sort();
  for (const file of paths) {
    const buf = files.get(file)!;
    if (buf.length > MAX_FILE_BYTES) continue;
    const text = buf.toString("utf8");
    const fileSha256 = sha256(buf);
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".jsx") ? ts.ScriptKind.JSX : ts.ScriptKind.TSX);
    let ordinal = 0;
    const visit = (node: ts.Node) => {
      if (ts.isJsxText(node) && !node.containsOnlyTriviaWhiteSpaces) {
        const raw = text.slice(node.pos, node.end);
        const lead = raw.length - raw.trimStart().length;
        const trimmed = raw.trim();
        if (trimmed) {
          const start = node.pos + lead;
          const end = start + trimmed.length;
          const { line, character } = sf.getLineAndCharacterOfPosition(start);
          ordinal += 1;
          out.push({
            file,
            ordinal,
            text: jsxRenderedText(trimmed),
            loc: { file, start, end, line: line + 1, column: character + 1, raw: trimmed, fileSha256, tag: tagName(node, sf) },
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

export const elementIdOf = (file: string, ordinal: number) => `t:${file}:${ordinal}`;

/** Texts the frozen success checks look for; editing them could fake or break success. */
function checkTexts(task: ImportTask): string[] {
  return task.successChecks.flatMap((c) => (c.kind === "text" ? [c.text] : c.kind === "control" ? [c.name] : []));
}

/**
 * Elements a frozen task protects: text a success check looks for (either containing the other, case-insensitive)
 * and text the designer listed as protected. These go into the protocol's `protectedElements`, so the policy blocks
 * patches to them and the model never sees them as editable; the candidate adapter checks them again.
 */
export function protectedByTask(m: ImportedManifest, task: ImportTask): { elementId: string; reason: string }[] {
  const checks = checkTexts(task).map(norm);
  const designer = task.protectedTexts.map(norm);
  return m.elements.flatMap((el) => {
    const n = norm(el.label ?? "");
    if (!n) return [];
    if (checks.some((c) => c.includes(n) || n.includes(c))) return [{ elementId: el.elementId, reason: "used by a success check" }];
    if (designer.some((p) => p === n || n.includes(p))) return [{ elementId: el.elementId, reason: "protected by the designer" }];
    return [];
  });
}

/**
 * The bounded editable-element manifest for one imported source version: each literal JSX text child becomes one
 * element whose only op is `set_label`. Text that is not uniquely addressable, contains entities or is too long is
 * listed but not editable, with the reason in `note`. Task-specific protection is applied per experiment
 * (`protectedByTask`), so a version's manifest and hash never depend on a task.
 */
export function buildManifest(args: {
  versionId: string;
  parentVersionId?: string;
  sourceHash: string;
  files: ReadonlyMap<string, Buffer>;
}): ImportedManifest {
  const texts = findJsxTexts(args.files);
  const counts = new Map<string, number>();
  for (const t of texts) counts.set(norm(t.text), (counts.get(norm(t.text)) ?? 0) + 1);

  const elements: ImportedElement[] = texts.map((t) => {
    let note: string | undefined;
    let ops: MutationOp[] = ["set_label"];
    if (t.loc.raw.includes("&")) [ops, note] = [[], "Contains HTML entities; edit it in Figma Make instead."];
    else if (t.text.length > MAX_TEXT) [ops, note] = [[], `Longer than ${MAX_TEXT} characters.`];
    else if ((counts.get(norm(t.text)) ?? 0) > 1) [ops, note] = [[], "The same text appears in several places, so a change would be ambiguous."];
    return {
      elementId: elementIdOf(t.file, t.ordinal),
      screen: t.file,
      role: roleOf(t.loc.tag),
      label: t.text,
      protected: false,
      categories: [],
      supportedOps: ops,
      source: t.loc,
      ...(note ? { note } : {}),
    };
  });
  const manifestHash = sha256(canonicalJson(elements.map(({ elementId, label, protected: p, supportedOps, source }) => ({ elementId, label, p, supportedOps, file: source.fileSha256 }))));
  return ImportedManifest.parse({
    schemaVersion: "1.0.0",
    versionId: args.versionId,
    ...(args.parentVersionId ? { parentVersionId: args.parentVersionId } : {}),
    manifestHash,
    sourceHash: args.sourceHash,
    elements,
  });
}

/** The contract view the optimizer consumes (extra fields stripped). */
export function toDesignManifest(m: ImportedManifest): DesignManifest {
  return DesignManifest.parse({
    schemaVersion: m.schemaVersion,
    versionId: m.versionId,
    ...(m.parentVersionId ? { parentVersionId: m.parentVersionId } : {}),
    manifestHash: m.manifestHash,
    elements: m.elements.map(({ source: _s, note: _n, ...el }) => el),
  });
}
