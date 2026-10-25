import { ImportError } from "./errors";
import { DEFAULT_ZIP_LIMITS, readZip, type ZipFile, type ZipLimits } from "./zip";

/** OS clutter that archivers add; never part of the app. */
const JUNK = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)/;
/** Installed or generated trees: rebuilt inside the sandbox, never trusted from the upload. */
const GENERATED = /(^|\/)(node_modules|\.git|\.vite|\.turbo|\.cache)(\/|$)/;
const VITE_CONFIGS = ["vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs", "vite.config.cjs"];

/** Frameworks we recognize and do not support, with the dependency that identifies them. */
const UNSUPPORTED: [string, string][] = [
  ["next", "Next.js"],
  ["nuxt", "Nuxt"],
  ["@remix-run/react", "Remix"],
  ["@angular/core", "Angular"],
  ["svelte", "Svelte"],
  ["vue", "Vue"],
  ["solid-js", "Solid"],
  ["astro", "Astro"],
  ["react-native", "React Native"],
];

export interface ProjectReport {
  /** Path of the app root inside the archive ("" when it is the archive root). */
  appRoot: string;
  /** The single wrapper directory that was stripped, if any. */
  wrapper?: string;
  fileCount: number;
  totalBytes: number;
  packageName?: string;
  viteConfig: string;
  reactVersion: string;
  viteVersion: string;
  hasLockfile: boolean;
  /** Paths ignored on purpose (OS clutter, node_modules, outside the app root). */
  skipped: { junk: number; generated: number; outsideRoot: number };
  warnings: string[];
}

export interface ValidatedProject {
  /** App files, relative to the app root. */
  files: ZipFile[];
  report: ProjectReport;
}

const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

/**
 * Validates an uploaded Figma Make code export: a safe ZIP containing exactly one frontend-only React + Vite
 * app. Strips one wrapper directory and OS clutter, drops installed/generated trees, and returns the app files
 * relative to the app root. Fails with an actionable `ImportError` for anything outside that support boundary.
 */
export function validateProject(zip: Buffer, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ValidatedProject {
  const all = readZip(zip, limits);
  const skipped = { junk: 0, generated: 0, outsideRoot: 0 };
  let files = all.filter((f) => {
    if (JUNK.test(f.path)) return void skipped.junk++, false;
    if (GENERATED.test(f.path)) return void skipped.generated++, false;
    return true;
  });
  if (files.length === 0) throw new ImportError("NO_APP_ROOT", "The ZIP contains no app files.", "Export the code from Figma Make (Export → Download code) and upload that ZIP.");

  // A single top-level directory holding everything is a wrapper, not part of the app.
  let wrapper: string | undefined;
  const tops = new Set(files.map((f) => f.path.split("/")[0]!));
  if (tops.size === 1 && files.every((f) => f.path.includes("/"))) {
    wrapper = [...tops][0]!;
    files = files.map((f) => ({ ...f, path: f.path.slice(wrapper!.length + 1) }));
  }

  const byPath = new Map(files.map((f) => [f.path, f]));
  const candidates = files
    .filter((f) => f.path === "package.json" || f.path.endsWith("/package.json"))
    .map((f) => dirOf(f.path))
    .filter((dir) => byPath.has(join(dir, "index.html")));
  if (candidates.length === 0) {
    const hasPkg = files.some((f) => f.path.endsWith("package.json"));
    throw hasPkg
      ? new ImportError("MISSING_INDEX_HTML", "Found package.json but no index.html next to it, so this is not a Vite web app.", "Upload the full code export from Figma Make, which includes index.html.")
      : new ImportError("NO_APP_ROOT", "No package.json found; this does not look like a code export.", "In Figma Make, use Export → Download code and upload that ZIP.");
  }
  const depth = (d: string) => (d === "" ? 0 : d.split("/").length);
  const shallowest = Math.min(...candidates.map(depth));
  const roots = candidates.filter((d) => depth(d) === shallowest);
  if (roots.length > 1) {
    throw new ImportError("AMBIGUOUS_APP_ROOT", `The ZIP contains several apps (${roots.map((r) => r || "(root)").join(", ")}).`, "Upload one Figma Make export per import.");
  }
  const appRoot = roots[0]!;
  const prefix = appRoot ? `${appRoot}/` : "";
  const appFiles = files.flatMap((f) => {
    if (prefix && !f.path.startsWith(prefix)) return void skipped.outsideRoot++, [];
    return [{ ...f, path: f.path.slice(prefix.length) }];
  });
  const app = new Map(appFiles.map((f) => [f.path, f]));

  let pkg: { name?: unknown; dependencies?: unknown; devDependencies?: unknown };
  try {
    const parsed: unknown = JSON.parse(app.get("package.json")!.data.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    pkg = parsed as typeof pkg;
  } catch (err) {
    throw new ImportError("INVALID_PACKAGE_JSON", `package.json is not valid JSON (${err instanceof Error ? err.message : String(err)}).`);
  }
  const deps: Record<string, string> = {};
  for (const block of [pkg.dependencies, pkg.devDependencies]) {
    if (block === undefined) continue;
    if (!block || typeof block !== "object" || Array.isArray(block)) throw new ImportError("INVALID_PACKAGE_JSON", "package.json dependencies must be objects.");
    for (const [k, v] of Object.entries(block)) if (typeof v === "string") deps[k] = v;
  }
  for (const [dep, framework] of UNSUPPORTED) {
    if (deps[dep]) {
      throw new ImportError("UNSUPPORTED_FRAMEWORK", `This project uses ${framework} (${dep}); GhostLoop imports only frontend React + Vite apps exported from Figma Make.`);
    }
  }
  if (!deps.react || !deps["react-dom"]) {
    throw new ImportError("UNSUPPORTED_FRAMEWORK", "package.json does not depend on react and react-dom; only React apps are supported.");
  }
  if (!deps.vite) {
    throw new ImportError("UNSUPPORTED_FRAMEWORK", "package.json does not depend on vite; only Vite projects are supported.", "Figma Make code exports are Vite projects; re-export the code.");
  }
  const viteConfig = VITE_CONFIGS.find((c) => app.has(c));
  if (!viteConfig) {
    throw new ImportError("MISSING_VITE_CONFIG", "No vite.config file found at the app root.", "Figma Make exports include vite.config.ts; upload the complete export.");
  }

  const warnings: string[] = [];
  const html = app.get("index.html")!.data.toString("utf8");
  if (!/<script[^>]+type=["']module["']/i.test(html)) warnings.push("index.html has no module script; the build may produce an empty page.");
  if (!appFiles.some((f) => /^src\/.*\.(tsx|jsx)$/.test(f.path))) warnings.push("No .tsx/.jsx files under src/; no text will be editable.");
  if (skipped.generated) warnings.push(`Ignored ${skipped.generated} installed or generated files (node_modules, .git); dependencies are installed fresh in the sandbox.`);
  if (deps["@supabase/supabase-js"] || deps.firebase) warnings.push("This app references a hosted backend; network calls from previews are blocked, so backend features will not work.");

  return {
    files: appFiles,
    report: {
      appRoot,
      ...(wrapper ? { wrapper } : {}),
      fileCount: appFiles.length,
      totalBytes: appFiles.reduce((n, f) => n + f.data.length, 0),
      ...(typeof pkg.name === "string" ? { packageName: pkg.name } : {}),
      viteConfig,
      reactVersion: deps.react,
      viteVersion: deps.vite,
      hasLockfile: app.has("package-lock.json"),
      skipped,
      warnings,
    },
  };
}
