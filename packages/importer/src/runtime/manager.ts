import { randomUUID } from "node:crypto";
import { appendFile, lstat, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ImportError } from "../errors";
import type { ImportStore } from "../store";
import { sha256 } from "../task";
import { docker, requireDocker, RUNTIME_HINT } from "./docker";

export const PREVIEW_SERVER = fileURLToPath(new URL("../../runtime/preview-server.mjs", import.meta.url));

export interface RuntimeLimits {
  installTimeoutMs: number;
  buildTimeoutMs: number;
  previewStartTimeoutMs: number;
  /** A preview nobody has used for this long is stopped (it restarts on demand). */
  previewIdleMs: number;
  maxPreviews: number;
  buildMemory: string;
  buildCpus: string;
  buildPids: number;
  previewMemory: string;
  previewCpus: string;
  maxLogBytes: number;
}

export const DEFAULT_LIMITS: RuntimeLimits = {
  installTimeoutMs: 6 * 60_000,
  buildTimeoutMs: 4 * 60_000,
  previewStartTimeoutMs: 20_000,
  previewIdleMs: 2 * 60 * 60_000,
  maxPreviews: 6,
  buildMemory: "2g",
  buildCpus: "2",
  buildPids: 512,
  previewMemory: "256m",
  previewCpus: "0.5",
  maxLogBytes: 256 * 1024,
};

export interface RuntimeManagerOptions {
  store: ImportStore;
  /** Base image for every sandbox step; must provide node and npm with a uid-1000 user. */
  image?: string;
  limits?: Partial<RuntimeLimits>;
  log?: (line: string) => void;
  now?: () => number;
}

interface PreviewState {
  versionId: string;
  port: number;
  container: string;
  lastUsed: number;
}

const DEPS_FILES = ["package.json", "package-lock.json", "npm-shrinkwrap.json", ".npmrc"];
const tail = (s: string, lines = 40) => s.trimEnd().split("\n").slice(-lines).join("\n");

/** Sandbox flags shared by every container that may run uploaded code. */
function hardened(limits: { memory: string; cpus: string; pids: number }): string[] {
  return [
    "--user", "1000:1000",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--read-only",
    // exec: native addons (e.g. @swc/core) copy themselves into a cache under $HOME=/tmp and load from there.
    "--tmpfs", "/tmp:rw,exec,nosuid,size=1g",
    "--pids-limit", String(limits.pids),
    "--memory", limits.memory,
    "--memory-swap", limits.memory,
    "--cpus", limits.cpus,
    "--ulimit", "nofile=4096:4096",
    "-e", "HOME=/tmp",
    "-e", "npm_config_cache=/tmp/.npm",
    "-e", "npm_config_update_notifier=false",
    "-e", "CI=1",
  ];
}

/**
 * Owns every container GhostLoop starts for imported apps. Dependency installation, the build and the preview each
 * run in a separate hardened container (non-root, no capabilities, read-only root, CPU/memory/PID/time limits,
 * bounded logs); builds have no network; previews serve static files with GhostLoop's own server on a loopback
 * port. No host secrets, Docker socket or repository files are ever mounted. Each container is labeled with this
 * process's owner ID; containers from a previous process are removed at startup, idle previews are stopped.
 */
export class RuntimeManager {
  readonly ownerId = randomUUID();
  readonly image: string;
  readonly limits: RuntimeLimits;
  private previews = new Map<string, PreviewState>();
  private starting = new Map<string, Promise<string>>();
  private sweeper: ReturnType<typeof setInterval> | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly log: (line: string) => void;
  private readonly now: () => number;
  private dockerVersion: string | undefined;

  constructor(private readonly opts: RuntimeManagerOptions) {
    this.image = opts.image ?? process.env.GHOSTLOOP_IMPORT_IMAGE ?? "node:22-bookworm";
    this.limits = { ...DEFAULT_LIMITS, ...opts.limits };
    this.log = opts.log ?? (() => {});
    this.now = opts.now ?? Date.now;
  }

  /** Checks the runtime and removes containers left by an earlier process. Throws RUNTIME_UNAVAILABLE without Docker. */
  async init(): Promise<{ dockerVersion: string; removed: number }> {
    this.dockerVersion = await requireDocker();
    const removed = await this.reap((owner) => owner !== this.ownerId);
    this.sweeper ??= setInterval(() => void this.sweep().catch(() => {}), 60_000);
    this.sweeper.unref?.();
    return { dockerVersion: this.dockerVersion, removed };
  }

  get available(): boolean {
    return this.dockerVersion !== undefined;
  }

  private labels(kind: string, importId: string, versionId: string): string[] {
    return ["--label", "ghostloop.managed=1", "--label", `ghostloop.owner=${this.ownerId}`, "--label", `ghostloop.kind=${kind}`, "--label", `ghostloop.import=${importId}`, "--label", `ghostloop.version=${versionId}`];
  }

  /** Removes managed containers whose owner matches `predicate`. */
  async reap(predicate: (owner: string) => boolean): Promise<number> {
    const r = await docker(["ps", "-a", "--filter", "label=ghostloop.managed=1", "--format", '{{.Names}}\t{{.Label "ghostloop.owner"}}'], { timeoutMs: 15_000 });
    if (r.code !== 0) return 0;
    const names = r.stdout.split("\n").filter(Boolean).map((l) => l.split("\t")).filter(([, owner]) => predicate(owner ?? "")).map(([name]) => name!);
    for (const name of names) await docker(["rm", "-f", name], { timeoutMs: 20_000 });
    return names.length;
  }

  private async ensureReady(): Promise<void> {
    if (!this.dockerVersion) this.dockerVersion = await requireDocker();
    const inspect = await docker(["image", "inspect", "--format", "{{.Id}}", this.image], { timeoutMs: 15_000 });
    if (inspect.code === 0) return;
    this.log(`pulling sandbox image ${this.image}`);
    const pull = await docker(["pull", this.image], { timeoutMs: 10 * 60_000 });
    if (pull.code !== 0) throw new ImportError("RUNTIME_UNAVAILABLE", `Could not pull the sandbox image ${this.image}.`, `${RUNTIME_HINT} The first import needs network access to pull ${this.image}. (${tail(pull.output, 3)})`);
  }

  /** Install and build steps share the host, so they run one at a time. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.catch(() => {}).then(fn);
    this.queue = run;
    return run;
  }

  /** Key of the dependency set: the files npm reads. Versions with the same dependencies share installed modules. */
  static depsKey(files: ReadonlyMap<string, Buffer>): string {
    return sha256(DEPS_FILES.map((f) => `${f}\u0000${files.has(f) ? sha256(files.get(f)!) : "-"}\n`).join(""));
  }

  depsVolume(importId: string, files: ReadonlyMap<string, Buffer>): string {
    return `gl-deps-${importId}-${RuntimeManager.depsKey(files).slice(0, 12)}`;
  }

  private async writeTree(dir: string, files: ReadonlyMap<string, Buffer>, only?: readonly string[]): Promise<void> {
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    for (const [rel, data] of files) {
      if (only && !only.includes(rel)) continue;
      const file = path.join(dir, rel);
      if (!file.startsWith(dir + path.sep)) throw new ImportError("ARCHIVE_UNSAFE_PATH", `refusing to write ${rel}`);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, data, { mode: 0o644 });
    }
  }

  private async step(args: {
    kind: "install" | "build";
    importId: string;
    versionId: string;
    dockerArgs: string[];
    command: string[];
    timeoutMs: number;
    signal: AbortSignal;
    logFile: string;
    failCode: "INSTALL_FAILED" | "BUILD_FAILED";
  }): Promise<void> {
    const container = `gl-${args.kind}-${args.versionId}-${randomUUID().slice(0, 6)}`;
    await mkdir(path.dirname(args.logFile), { recursive: true });
    await writeFile(args.logFile, `$ ${args.command.join(" ")}\n`);
    const r = await docker(
      ["run", "--rm", "--name", container, ...this.labels(args.kind, args.importId, args.versionId), ...args.dockerArgs, this.image, ...args.command],
      { timeoutMs: args.timeoutMs, signal: args.signal, container, maxOutputBytes: this.limits.maxLogBytes, onOutput: (s) => void appendFile(args.logFile, s).catch(() => {}) },
    );
    if (r.cancelled) throw new ImportError("CANCELLED", `The ${args.kind} step was cancelled.`);
    if (r.timedOut) throw Object.assign(new ImportError("TIMEOUT", `The ${args.kind} step exceeded ${Math.round(args.timeoutMs / 1000)} s and was stopped.`, "Large dependency sets can be slow; retry, or remove unused dependencies."), { logTail: tail(r.output) });
    if (r.code !== 0) {
      const oom = r.code === 137 ? " It was stopped for exceeding its memory limit." : "";
      const hint = args.kind === "install" ? "Check package.json for private or misspelled packages; only public npm packages can be installed." : "Open the log for the first error. The app must build with `vite build`.";
      throw Object.assign(new ImportError(args.failCode, `The ${args.kind} step failed (exit ${r.code}).${oom}`, hint), { logTail: tail(r.output) });
    }
  }

  /**
   * Installs dependencies into a Docker volume keyed by the dependency files, once per import and dependency set.
   * Install scripts are disabled (`--ignore-scripts`), and only the dependency files are visible to npm.
   */
  async install(importId: string, versionId: string, files: ReadonlyMap<string, Buffer>, signal: AbortSignal): Promise<string> {
    return this.serial(async () => {
      signal.throwIfAborted();
      await this.ensureReady();
      const volume = this.depsVolume(importId, files);
      // Create (labeled) before anything mounts it; mounting an unknown name would create an unlabeled volume.
      const exists = (await docker(["volume", "inspect", volume], { timeoutMs: 15_000 })).code === 0;
      if (!exists) {
        const created = await docker(["volume", "create", "--label", "ghostloop.managed=1", "--label", `ghostloop.import=${importId}`, volume], { timeoutMs: 20_000 });
        if (created.code !== 0) throw new ImportError("RUNTIME_UNAVAILABLE", `Could not create the dependency volume: ${tail(created.output, 3)}`, RUNTIME_HINT);
      } else {
        const marker = await docker(["run", "--rm", "--network", "none", "-v", `${volume}:/m:ro`, "--entrypoint", "test", this.image, "-f", "/m/.ghostloop-installed"], { timeoutMs: 30_000 });
        if (marker.code === 0) {
          this.log(`[${importId}] reusing installed dependencies (${volume})`);
          return volume;
        }
      }
      // A fresh volume is root-owned; hand it to the unprivileged build user. Runs no uploaded code.
      const own = await docker(["run", "--rm", "--network", "none", "--cap-drop", "ALL", "--cap-add", "CHOWN", "-v", `${volume}:/m`, "--entrypoint", "chown", this.image, "1000:1000", "/m"], { timeoutMs: 30_000 });
      if (own.code !== 0) throw new ImportError("RUNTIME_UNAVAILABLE", `Could not prepare the dependency volume: ${tail(own.output, 3)}`, RUNTIME_HINT);
      const dir = path.join(this.opts.store.dir.work(versionId), "install");
      await this.writeTree(dir, files, DEPS_FILES);
      const npm = files.has("package-lock.json") || files.has("npm-shrinkwrap.json") ? "ci" : "install";
      await this.step({
        kind: "install",
        importId,
        versionId,
        dockerArgs: [...hardened({ memory: this.limits.buildMemory, cpus: this.limits.buildCpus, pids: this.limits.buildPids }), "-v", `${dir}:/app`, "-v", `${volume}:/app/node_modules`, "-w", "/app"],
        command: ["sh", "-c", `npm ${npm} --ignore-scripts --no-audit --no-fund --loglevel=error && touch node_modules/.ghostloop-installed`],
        timeoutMs: this.limits.installTimeoutMs,
        signal,
        logFile: path.join(this.opts.store.dir.build(versionId), "install.log"),
        failCode: "INSTALL_FAILED",
      });
      return volume;
    });
  }

  /** Builds one version with `vite build` in a container with no network. Output lands in `builds/<ver>/out`. */
  async build(importId: string, versionId: string, files: ReadonlyMap<string, Buffer>, volume: string, signal: AbortSignal): Promise<string> {
    return this.serial(async () => {
      signal.throwIfAborted();
      await this.ensureReady();
      const src = path.join(this.opts.store.dir.work(versionId), "src");
      const out = path.join(this.opts.store.dir.build(versionId), "out");
      await this.writeTree(src, files);
      await rm(out, { recursive: true, force: true });
      await mkdir(out, { recursive: true });
      await this.step({
        kind: "build",
        importId,
        versionId,
        dockerArgs: [
          ...hardened({ memory: this.limits.buildMemory, cpus: this.limits.buildCpus, pids: this.limits.buildPids }),
          "--network", "none",
          "-e", "NODE_OPTIONS=--max-old-space-size=1536",
          "-v", `${src}:/app`,
          "-v", `${volume}:/app/node_modules`,
          "-v", `${out}:/out`,
          "-w", "/app",
        ],
        command: ["node", "node_modules/vite/bin/vite.js", "build", "--outDir", "/out", "--emptyOutDir", "--base", "/"],
        timeoutMs: this.limits.buildTimeoutMs,
        signal,
        logFile: path.join(this.opts.store.dir.build(versionId), "build.log"),
        failCode: "BUILD_FAILED",
      });
      const index = await lstat(path.join(out, "index.html")).catch(() => undefined);
      if (!index?.isFile()) throw new ImportError("BUILD_FAILED", "The build finished but produced no index.html.", "Check that index.html is at the app root and references your entry script.");
      await rm(src, { recursive: true, force: true }).catch(() => {});
      return out;
    });
  }

  url(port: number): string {
    return `http://127.0.0.1:${port}`;
  }

  /** Starts (or reuses) the preview container for a built version on its fixed loopback port; returns its origin. */
  async ensurePreview(importId: string, versionId: string, port: number): Promise<string> {
    const live = this.previews.get(versionId);
    if (live && (await this.healthy(port))) {
      live.lastUsed = this.now();
      return this.url(port);
    }
    const pending = this.starting.get(versionId);
    if (pending) return pending;
    const start = this.startPreview(importId, versionId, port).finally(() => this.starting.delete(versionId));
    this.starting.set(versionId, start);
    return start;
  }

  private async startPreview(importId: string, versionId: string, port: number): Promise<string> {
    if (!this.dockerVersion) this.dockerVersion = await requireDocker();
    const out = path.join(this.opts.store.dir.build(versionId), "out");
    const index = await lstat(path.join(out, "index.html")).catch(() => undefined);
    if (!index?.isFile()) throw new ImportError("PREVIEW_FAILED", `Version ${versionId} has no successful build to preview.`);
    await this.evictFor(versionId);
    const container = `gl-preview-${versionId}`;
    await docker(["rm", "-f", container], { timeoutMs: 20_000 });
    const r = await docker(
      [
        "run", "-d", "--name", container, ...this.labels("preview", importId, versionId),
        ...hardened({ memory: this.limits.previewMemory, cpus: this.limits.previewCpus, pids: 64 }),
        "-p", `127.0.0.1:${port}:8080`,
        "-v", `${out}:/srv:ro`,
        "-v", `${PREVIEW_SERVER}:/gl/preview-server.mjs:ro`,
        this.image, "node", "/gl/preview-server.mjs",
      ],
      { timeoutMs: 60_000 },
    );
    if (r.code !== 0) {
      const busy = /port is already allocated|address already in use/i.test(r.output);
      throw new ImportError("PREVIEW_FAILED", busy ? `Preview port ${port} is in use by another program.` : `The preview container did not start: ${tail(r.output, 4)}`, busy ? `Free port ${port} and retry.` : undefined);
    }
    const deadline = this.now() + this.limits.previewStartTimeoutMs;
    while (this.now() < deadline) {
      if (await this.healthy(port)) {
        this.previews.set(versionId, { versionId, port, container, lastUsed: this.now() });
        this.log(`[${importId}] preview ${versionId} on ${this.url(port)}`);
        return this.url(port);
      }
      await new Promise((res) => setTimeout(res, 300));
    }
    const logs = await docker(["logs", "--tail", "20", container], { timeoutMs: 10_000 });
    await docker(["rm", "-f", container], { timeoutMs: 20_000 });
    throw new ImportError("PREVIEW_FAILED", `The preview did not answer within ${this.limits.previewStartTimeoutMs / 1000} s. ${tail(logs.output, 5)}`);
  }

  private async healthy(port: number): Promise<boolean> {
    try {
      const res = await fetch(`${this.url(port)}/`, { signal: AbortSignal.timeout(2000) });
      await res.body?.cancel();
      return res.ok && res.headers.get("x-ghostloop-preview") === "1";
    } catch {
      return false;
    }
  }

  /** Marks a preview as in use so the idle sweep keeps it. */
  touch(versionId: string): void {
    const p = this.previews.get(versionId);
    if (p) p.lastUsed = this.now();
  }

  async stopPreview(versionId: string): Promise<void> {
    const p = this.previews.get(versionId);
    this.previews.delete(versionId);
    await docker(["rm", "-f", p?.container ?? `gl-preview-${versionId}`], { timeoutMs: 20_000 });
  }

  /** Stops previews idle longer than the limit. */
  async sweep(): Promise<string[]> {
    const stale = [...this.previews.values()].filter((p) => this.now() - p.lastUsed > this.limits.previewIdleMs).map((p) => p.versionId);
    for (const v of stale) await this.stopPreview(v);
    return stale;
  }

  private async evictFor(versionId: string): Promise<void> {
    const others = [...this.previews.values()].filter((p) => p.versionId !== versionId).sort((a, b) => a.lastUsed - b.lastUsed);
    while (others.length >= this.limits.maxPreviews) await this.stopPreview(others.shift()!.versionId);
  }

  runningPreviews(): string[] {
    return [...this.previews.keys()];
  }

  /** Stops every container this process owns. */
  async shutdown(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = undefined;
    this.previews.clear();
    if (this.dockerVersion) await this.reap((owner) => owner === this.ownerId);
  }
}
