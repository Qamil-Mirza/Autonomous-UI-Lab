import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CandidateDesign, MutationPatch } from "@ghostloop/contracts";
import { ImportError } from "./errors";
import { ImportedManifest } from "./manifest";
import { FrozenTask, ImportTask, canonicalJson, sha256, taskHash } from "./task";

export const ImportStatus = z.enum([
  "uploading", "validating", "installing", "building", "starting", "ready_for_review", "ready_to_test", "failed", "cancelled",
]);
export type ImportStatus = z.infer<typeof ImportStatus>;

export const ErrorRecord = z.object({
  code: z.string(),
  message: z.string(),
  hint: z.string().optional(),
  /** Pipeline step that failed. */
  step: z.string().optional(),
  /** Last lines of the sandbox output, when a sandbox step failed. */
  logTail: z.string().optional(),
});

const Verification = z.object({
  taskHash: z.string(),
  ok: z.boolean(),
  at: z.string(),
  screenshot: z.string().optional(),
  url: z.string(),
  controls: z.array(z.object({ ref: z.string(), role: z.string(), label: z.string() })),
  checks: z.array(z.object({ name: z.string(), description: z.string(), passedAtStart: z.boolean(), detail: z.string() })),
  blockers: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type Verification = z.infer<typeof Verification>;

export const ImportRecord = z.object({
  schemaVersion: z.literal("1.0.0"),
  id: z.string().regex(/^imp_[0-9a-f]{12}$/),
  name: z.string().min(1).max(120),
  figmaUrl: z.string().url().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: ImportStatus,
  /** Human-readable detail of the current step. */
  detail: z.string().optional(),
  attempt: z.number().int().positive(),
  upload: z.object({ sha256: z.string().length(64), bytes: z.number().int().nonnegative(), fileName: z.string().optional() }),
  report: z.unknown().optional(),
  error: ErrorRecord.optional(),
  baseVersionId: z.string().optional(),
  /** Designer's current task draft (validated). */
  task: ImportTask.optional(),
  verification: Verification.optional(),
  /** The frozen task new experiments run under. */
  frozenTask: z.object({ hash: z.string().length(64), frozenAt: z.string() }).optional(),
  experiments: z.array(z.object({ experimentId: z.string(), taskHash: z.string(), createdAt: z.string() })),
});
export type ImportRecord = z.infer<typeof ImportRecord>;

/** One immutable source version of an imported app (the upload, or a candidate built from it). */
export const VersionRecord = z.object({
  schemaVersion: z.literal("1.0.0"),
  versionId: z.string().regex(/^ver_imp_[0-9a-f]{12}$/),
  importId: z.string(),
  parentVersionId: z.string().optional(),
  sourceHash: z.string().length(64),
  /** Fixed loopback port this version's preview is always published on, so its URL is stable. */
  port: z.number().int().min(1024).max(65535),
  patchIds: z.array(z.string()),
  changes: z.array(z.object({ patchId: z.string(), elementId: z.string(), file: z.string(), line: z.number(), before: z.string(), after: z.string() })),
  manifest: ImportedManifest,
  createdAt: z.string(),
});
export type VersionRecord = z.infer<typeof VersionRecord>;

export const BuildState = z.object({
  status: z.enum(["pending", "installing", "building", "ready", "failed", "cancelled"]),
  updatedAt: z.string(),
  error: ErrorRecord.optional(),
});
export type BuildState = z.infer<typeof BuildState>;

export const ImportedCandidateRecord = z.object({
  candidate: CandidateDesign,
  importId: z.string(),
  experimentId: z.string(),
  taskHash: z.string().length(64),
  patches: z.array(MutationPatch),
});
export type ImportedCandidateRecord = z.infer<typeof ImportedCandidateRecord>;

export const PORT_RANGE = { from: 47100, to: 47999 } as const;

const ID = /^[A-Za-z0-9_]+$/;
const assertId = (id: string, what: string) => {
  if (!ID.test(id)) throw new ImportError("NOT_FOUND", `invalid ${what} ${JSON.stringify(id)}`);
};
const exists = async (p: string) => stat(p).then(() => true, () => false);

async function readJson<S extends z.ZodTypeAny>(schema: S, file: string): Promise<z.infer<S> | undefined> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  return schema.parse(JSON.parse(text));
}

/** Writes through a temporary file and an atomic rename, so readers never see a partial record. */
async function writeAtomic(file: string, data: string): Promise<void> {
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, data, { flag: "wx" });
  await rename(tmp, file);
}

/** Insert-only: an existing file is never overwritten. The file is then made read-only. */
async function writeOnce(file: string, data: string | Buffer): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data, { flag: "wx" });
  await chmod(file, 0o444);
}

/**
 * Filesystem store for imports, following the `designs/` pattern: insert-only JSON records and read-only
 * content-addressed source trees, plus a few mutable status records written atomically.
 *
 * ```
 * <root>/imports/<imp>/record.json   mutable status (atomic rename)
 * <root>/imports/<imp>/upload.zip    the original upload, read-only
 * <root>/sources/<sha256>/...        immutable source trees (content-addressed)
 * <root>/versions/<ver>.json         immutable version records
 * <root>/tasks/<sha256>.json         frozen tasks (hash-verified on read)
 * <root>/candidates/<cand>.json      immutable candidate records
 * <root>/builds/<ver>/{out,state.json,*.log}
 * ```
 */
export class ImportStore {
  private locks = new Map<string, Promise<unknown>>();
  constructor(readonly root: string) {}

  dir = {
    import: (id: string) => path.join(this.root, "imports", id),
    source: (hash: string) => path.join(this.root, "sources", hash),
    build: (versionId: string) => path.join(this.root, "builds", versionId),
    work: (versionId: string) => path.join(this.root, "work", versionId),
  };

  async init(): Promise<void> {
    for (const d of ["imports", "sources", "versions", "tasks", "candidates", "builds", "work"]) await mkdir(path.join(this.root, d), { recursive: true });
  }

  // ---- imports ----

  async createImport(rec: ImportRecord): Promise<void> {
    const parsed = ImportRecord.parse(rec);
    await mkdir(this.dir.import(parsed.id), { recursive: false });
    await writeFile(path.join(this.dir.import(parsed.id), "record.json"), JSON.stringify(parsed, null, 2), { flag: "wx" });
  }

  async getImport(id: string): Promise<ImportRecord | undefined> {
    if (!/^imp_[0-9a-f]{12}$/.test(id)) return undefined;
    return readJson(ImportRecord, path.join(this.dir.import(id), "record.json"));
  }

  async listImports(): Promise<ImportRecord[]> {
    const ids = await readdir(path.join(this.root, "imports")).catch(() => [] as string[]);
    const out: ImportRecord[] = [];
    for (const id of ids) {
      const rec = await this.getImport(id).catch(() => undefined);
      if (rec) out.push(rec);
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Serialized read-modify-write of one import record; `change` may throw to write nothing. */
  async updateImport(id: string, change: (r: ImportRecord) => ImportRecord): Promise<ImportRecord> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(async () => {
      const cur = await this.getImport(id);
      if (!cur) throw new ImportError("NOT_FOUND", `import ${id} not found`);
      const updated = ImportRecord.parse({ ...change(cur), updatedAt: new Date().toISOString() });
      await writeAtomic(path.join(this.dir.import(id), "record.json"), JSON.stringify(updated, null, 2));
      return updated;
    });
    this.locks.set(id, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(id) === next) this.locks.delete(id);
    }
  }

  async writeUpload(id: string, zip: Buffer): Promise<void> {
    await writeOnce(path.join(this.dir.import(id), "upload.zip"), zip);
  }

  async readUpload(id: string): Promise<Buffer> {
    assertId(id, "import id");
    return readFile(path.join(this.dir.import(id), "upload.zip"));
  }

  // ---- sources ----

  /** Content hash of a file tree: sorted `path NUL sha256` lines. */
  static sourceHash(files: ReadonlyMap<string, Buffer>): string {
    return sha256([...files.keys()].sort().map((p) => `${p}\u0000${sha256(files.get(p)!)}\n`).join(""));
  }

  /** Stores a source tree once (read-only files) and returns its hash; an identical tree is reused. */
  async putSource(files: ReadonlyMap<string, Buffer>): Promise<string> {
    const hash = ImportStore.sourceHash(files);
    const dest = this.dir.source(hash);
    if (await exists(dest)) return hash;
    const tmp = `${dest}.${randomUUID()}.tmp`;
    for (const [rel, data] of files) {
      const file = path.join(tmp, rel);
      // Paths were validated by the archive reader; refuse anything that would still resolve outside.
      if (!file.startsWith(tmp + path.sep)) throw new ImportError("ARCHIVE_UNSAFE_PATH", `refusing to write ${rel}`);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, data, { flag: "wx", mode: 0o444 });
    }
    await writeFile(path.join(tmp, ".ghostloop-files.json"), JSON.stringify([...files.keys()].sort()), { flag: "wx", mode: 0o444 });
    try {
      await rename(tmp, dest);
    } catch (err) {
      await rm(tmp, { recursive: true, force: true });
      if (!(await exists(dest))) throw err;
    }
    return hash;
  }

  /** Reads a stored source tree and verifies its hash. */
  async readSource(hash: string): Promise<Map<string, Buffer>> {
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new ImportError("NOT_FOUND", `invalid source hash ${hash}`);
    const dir = this.dir.source(hash);
    const list = z.array(z.string()).parse(JSON.parse(await readFile(path.join(dir, ".ghostloop-files.json"), "utf8")));
    const files = new Map<string, Buffer>();
    for (const rel of list) {
      const file = path.join(dir, rel);
      if (!file.startsWith(dir + path.sep)) throw new ImportError("ARCHIVE_UNSAFE_PATH", `bad stored path ${rel}`);
      files.set(rel, await readFile(file));
    }
    if (ImportStore.sourceHash(files) !== hash) throw new ImportError("INVALID_STATE", `source ${hash} was modified on disk`);
    return files;
  }

  // ---- versions ----

  async insertVersion(v: VersionRecord): Promise<void> {
    const parsed = VersionRecord.parse(v);
    try {
      await writeOnce(path.join(this.root, "versions", `${parsed.versionId}.json`), JSON.stringify(parsed, null, 2));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") throw new ImportError("INVALID_STATE", `version ${parsed.versionId} already exists`);
      throw err;
    }
  }

  async getVersion(versionId: string): Promise<VersionRecord | undefined> {
    if (!/^ver_imp_[0-9a-f]{12}$/.test(versionId)) return undefined;
    return readJson(VersionRecord, path.join(this.root, "versions", `${versionId}.json`));
  }

  async listVersions(importId?: string): Promise<VersionRecord[]> {
    const names = await readdir(path.join(this.root, "versions")).catch(() => [] as string[]);
    const out: VersionRecord[] = [];
    for (const n of names) {
      if (!n.endsWith(".json")) continue;
      const v = await this.getVersion(n.slice(0, -5)).catch(() => undefined);
      if (v && (!importId || v.importId === importId)) out.push(v);
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** Next free loopback port in the preview range, not used by any version and bindable right now. */
  async allocatePort(): Promise<number> {
    const used = new Set((await this.listVersions()).map((v) => v.port));
    for (let port = PORT_RANGE.from; port <= PORT_RANGE.to; port++) {
      if (used.has(port) || this.reserved.has(port)) continue;
      if (await portFree(port)) {
        this.reserved.add(port);
        return port;
      }
    }
    throw new ImportError("PREVIEW_FAILED", `No free preview port in ${PORT_RANGE.from}-${PORT_RANGE.to}.`);
  }
  private reserved = new Set<number>();

  async getBuild(versionId: string): Promise<BuildState | undefined> {
    return readJson(BuildState, path.join(this.dir.build(versionId), "state.json"));
  }

  async setBuild(versionId: string, state: Omit<BuildState, "updatedAt">): Promise<BuildState> {
    const full = BuildState.parse({ ...state, updatedAt: new Date().toISOString() });
    await mkdir(this.dir.build(versionId), { recursive: true });
    await writeAtomic(path.join(this.dir.build(versionId), "state.json"), JSON.stringify(full, null, 2));
    return full;
  }

  // ---- frozen tasks ----

  async putFrozenTask(t: FrozenTask): Promise<string> {
    const parsed = FrozenTask.parse(t);
    const hash = taskHash(parsed);
    const file = path.join(this.root, "tasks", `${hash}.json`);
    if (await exists(file)) return hash;
    await writeOnce(file, canonicalJson(parsed));
    return hash;
  }

  /** Reads a frozen task; the content must still hash to its name, so an edited file is refused. */
  async getFrozenTask(hash: string): Promise<FrozenTask | undefined> {
    if (!/^[0-9a-f]{64}$/.test(hash)) return undefined;
    const t = await readJson(FrozenTask, path.join(this.root, "tasks", `${hash}.json`));
    if (t && taskHash(t) !== hash) throw new ImportError("INVALID_STATE", `frozen task ${hash} does not match its hash; it was modified`);
    return t;
  }

  // ---- candidates ----

  async insertCandidate(rec: ImportedCandidateRecord): Promise<void> {
    const parsed = ImportedCandidateRecord.parse(rec);
    await writeOnce(path.join(this.root, "candidates", `${parsed.candidate.id}.json`), JSON.stringify(parsed, null, 2));
  }

  async getCandidate(candidateId: string): Promise<ImportedCandidateRecord | undefined> {
    if (!/^cand_[A-Za-z0-9]+$/.test(candidateId)) return undefined;
    return readJson(ImportedCandidateRecord, path.join(this.root, "candidates", `${candidateId}.json`));
  }
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}
