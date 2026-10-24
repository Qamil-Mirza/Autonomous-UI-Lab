// Writes designs/figma/<versionId>.json from Figma read-backs (figma/snapshot.js output, saved as { fileKey, frames }).
// Usage:
//   npm run figma:mapping -w @ghostloop/prototype-adapter -- --version ver_baseline --snapshot baseline.json --frame-url <page url>
//   npm run figma:mapping -w @ghostloop/prototype-adapter -- --version <ver> --snapshot variant.json --baseline-snapshot baseline.json --frame-url <frame url>
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { FigmaSnapshot } from "@ghostloop/design-engine";
import { buildFigmaMapping, defaultDesignsDir, readVersion, writeFigmaMapping } from "../src";

const { values } = parseArgs({
  options: { version: { type: "string" }, snapshot: { type: "string" }, "baseline-snapshot": { type: "string" }, "frame-url": { type: "string" } },
});
if (!values.version || !values.snapshot || !values["frame-url"]) {
  console.error("usage: figma:mapping --version <versionId> --snapshot <file> --frame-url <url> [--baseline-snapshot <file>]");
  process.exit(2);
}

const designsDir = defaultDesignsDir();
const readSnapshot = async (file: string) => FigmaSnapshot.parse(JSON.parse(await readFile(file, "utf8")));
const manifest = await readVersion(designsDir, values.version);
let parent;
if (manifest.parentVersionId) {
  if (!values["baseline-snapshot"]) {
    console.error(`${manifest.versionId} is a candidate of ${manifest.parentVersionId}: pass --baseline-snapshot with its parent's frames`);
    process.exit(2);
  }
  parent = { manifest: await readVersion(designsDir, manifest.parentVersionId), snapshot: await readSnapshot(values["baseline-snapshot"]) };
}

const mapping = buildFigmaMapping({ manifest, parent, snapshot: await readSnapshot(values.snapshot), frameUrl: values["frame-url"] });
const file = await writeFigmaMapping(designsDir, mapping);
const failed = mapping.checks.filter((c) => !c.passed);
console.log(`${mapping.versionId}: ${mapping.status} (${mapping.checks.length - failed.length}/${mapping.checks.length} checks passed) → ${file}`);
for (const c of failed) console.log(`  ✗ ${c.elementId} ${c.field} [${c.frame}]: expected ${c.expected}, got ${c.actual}${c.note ? ` (${c.note})` : ""}`);
