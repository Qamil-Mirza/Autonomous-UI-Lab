// Packs the hand-written compatibility fixture (NOT a real Figma Make export) into a ZIP shaped like a download:
// everything inside one wrapper directory, deflated, plus the macOS clutter real archives often carry.
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeZip, type WriteEntry } from "../test/support/zip-writer";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "../fixtures/northwind-make-export");
const out = path.resolve(process.argv[2] ?? path.join(here, "../fixtures/northwind-make-export.zip"));
const WRAPPER = "Northwind Coffee Make fixture";

async function walk(dir: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(path.join(dir, e.name), r)));
    else if (e.isFile()) out.push(r);
  }
  return out.sort();
}

const entries: WriteEntry[] = [];
for (const rel of await walk(src)) entries.push({ name: `${WRAPPER}/${rel}`, data: await readFile(path.join(src, rel)), unixMode: 0o100644 });
entries.push({ name: `__MACOSX/${WRAPPER}/._package.json`, data: "mac resource fork" });
await writeFile(out, writeZip(entries));
console.log(`wrote ${out} (${entries.length} entries) — COMPATIBILITY FIXTURE, not a real Figma Make export`);
