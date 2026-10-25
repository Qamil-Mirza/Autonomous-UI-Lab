import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  CandidateDesign,
  ExperimentProtocolDraft,
  SCHEMA_VERSION,
  ValidationResult,
  newId,
  type BatchRequest,
  type CandidateAdapter,
  type CommandResult,
  type MutationPatch,
  type ScreenshotRef,
  type ValidationCheck,
} from "@ghostloop/contracts";
import { discoverControls, openBrowserSession, waitForDiscoveryReady, type AppIntegration } from "@ghostloop/simulator";
import { validateProject } from "./archive";
import { evaluateChecks } from "./checks";
import { ImportError, errorInfo } from "./errors";
import { importedIntegration, previewRequestPolicy } from "./integration";
import { buildManifest, protectedByTask, toDesignManifest, type ImportedManifest } from "./manifest";
import { applyLabelPatches, diffAgainstParent } from "./patch";
import { RuntimeManager } from "./runtime/manager";
import { ImportRecord, ImportStore, type VersionRecord, type Verification } from "./store";
import {
  CHECK_CAVEAT,
  DEFAULT_PERSONAS,
  FrozenTask,
  ImportTask,
  canonicalJson,
  checkName,
  describeCheck,
  parseTaskRef,
  sha256,
  taskRef,
  type ImportTaskDraft,
} from "./task";
import { DEFAULT_ZIP_LIMITS } from "./zip";

/** The two designer commands an import needs; the optimizer's `createCommands` provides them. */
export interface ExperimentCommands {
  createExperiment(payload: unknown): Promise<CommandResult<unknown>>;
  startExperiment(payload: unknown): Promise<CommandResult<unknown>>;
}

export interface ImportServiceOptions {
  /** Store root, e.g. `<repo>/.ghostloop/imports`. */
  root: string;
  /** Where verification screenshots go; the dashboard serves this tree at /artifacts. */
  artifactsDir: string;
  publishScreenshot?: (shot: ScreenshotRef) => Promise<ScreenshotRef>;
  runtime?: RuntimeManager;
  commands?: ExperimentCommands;
  log?: (line: string) => void;
}

export interface StartExperimentOptions {
  trials: number;
  maxSteps: number;
  maxUsd: number;
  maxMinutes: number;
  minImprovementPp: number;
}

const LIMITS = { trials: 100, maxSteps: 20 };

const hex12 = () => randomBytes(6).toString("hex");
const now = () => new Date().toISOString();
const draftHash = (t: ImportTask) => sha256(canonicalJson(t));

/** Splits `total` runs across `n` personas as evenly as possible. */
function allocate(total: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => Math.floor(total / n) + (i < total % n ? 1 : 0));
}

/**
 * Orchestrates the import workflow: upload → validate → store an immutable source version → install → build →
 * preview, then the designer's task, a verification pass, freezing, and experiment creation. Also implements the
 * imported-app side of the experiment loop (simulation integration and the CandidateAdapter). Every sandbox
 * step goes through `RuntimeManager`; nothing uploaded runs in this process.
 */
export class ImportService {
  readonly store: ImportStore;
  readonly runtime: RuntimeManager;
  private readonly log: (line: string) => void;
  private jobs = new Map<string, AbortController>();
  private runtimeError: { code: string; message: string; hint?: string } | undefined;
  commands: ExperimentCommands | undefined;

  constructor(private readonly opts: ImportServiceOptions) {
    this.store = new ImportStore(opts.root);
    this.log = opts.log ?? (() => {});
    this.runtime = opts.runtime ?? new RuntimeManager({ store: this.store, log: this.log });
    this.commands = opts.commands;
  }

  /** Prepares storage and checks the sandbox runtime. A missing runtime is reported, not thrown, so the API can explain it. */
  async init(): Promise<void> {
    await this.store.init();
    try {
      const { dockerVersion, removed } = await this.runtime.init();
      this.runtimeError = undefined;
      this.log(`imports: Docker ${dockerVersion} ready${removed ? `, removed ${removed} stale container(s)` : ""}`);
    } catch (err) {
      this.runtimeError = errorInfo(err);
      this.log(`imports: ${this.runtimeError.message} ${this.runtimeError.hint ?? ""}`);
    }
    // Imports interrupted by a restart cannot resume a half-finished sandbox step: mark them so they can be retried.
    for (const rec of await this.store.listImports()) {
      if (["uploading", "validating", "installing", "building", "starting"].includes(rec.status)) {
        await this.store.updateImport(rec.id, (r) => ({ ...r, status: "failed", error: { code: "INTERRUPTED", message: "GhostLoop restarted during this step.", hint: "Retry the import.", step: r.status } }));
      }
    }
  }

  async runtimeStatus(): Promise<{ available: boolean; image: string; error?: { code: string; message: string; hint?: string } }> {
    if (!this.runtime.available) {
      try {
        await this.runtime.init();
        this.runtimeError = undefined;
      } catch (err) {
        this.runtimeError = errorInfo(err);
      }
    }
    return { available: this.runtime.available, image: this.runtime.image, ...(this.runtimeError ? { error: this.runtimeError } : {}) };
  }

  async shutdown(): Promise<void> {
    for (const c of this.jobs.values()) c.abort(new ImportError("CANCELLED", "GhostLoop is shutting down."));
    await this.runtime.shutdown();
  }

  // ---------------------------------------------------------------- import pipeline

  async list(): Promise<ImportRecord[]> {
    return this.store.listImports();
  }

  async get(id: string): Promise<ImportRecord> {
    const rec = await this.store.getImport(id);
    if (!rec) throw new ImportError("NOT_FOUND", `Import ${id} not found.`);
    return rec;
  }

  /** Accepts an upload and starts the pipeline in the background. Returns once the upload is stored. */
  async createImport(args: { name: string; figmaUrl?: string; fileName?: string; zip: Buffer }): Promise<ImportRecord> {
    const name = args.name.trim();
    if (!name || name.length > 120) throw new ImportError("INVALID_TASK", "Give the project a name (up to 120 characters).");
    if (args.figmaUrl !== undefined && args.figmaUrl !== "") {
      let u: URL;
      try {
        u = new URL(args.figmaUrl);
      } catch {
        throw new ImportError("INVALID_TASK", "The Figma link is not a valid URL.");
      }
      if (u.protocol !== "https:" || !/(^|\.)figma\.com$/.test(u.hostname)) throw new ImportError("INVALID_TASK", "The Figma link must be an https://figma.com URL.");
    }
    if (args.zip.length > DEFAULT_ZIP_LIMITS.maxArchiveBytes) {
      throw new ImportError("ARCHIVE_TOO_LARGE", `The ZIP is larger than ${DEFAULT_ZIP_LIMITS.maxArchiveBytes / 1024 / 1024} MB.`);
    }
    const id = `imp_${hex12()}`;
    const t = now();
    const rec: ImportRecord = {
      schemaVersion: "1.0.0",
      id,
      name,
      ...(args.figmaUrl ? { figmaUrl: args.figmaUrl } : {}),
      createdAt: t,
      updatedAt: t,
      status: "uploading",
      detail: "Storing the upload",
      attempt: 1,
      upload: { sha256: sha256(args.zip), bytes: args.zip.length, ...(args.fileName ? { fileName: args.fileName.slice(0, 200) } : {}) },
      experiments: [],
    };
    await this.store.createImport(rec);
    await this.store.writeUpload(id, args.zip);
    this.launch(id);
    return this.get(id);
  }

  private launch(id: string): void {
    const controller = new AbortController();
    this.jobs.set(id, controller);
    void this.pipeline(id, controller.signal).finally(() => {
      if (this.jobs.get(id) === controller) this.jobs.delete(id);
    });
  }

  private async status(id: string, status: ImportRecord["status"], detail?: string, extra: Partial<ImportRecord> = {}): Promise<void> {
    await this.store.updateImport(id, (r) => {
      if (r.status === "cancelled") throw new ImportError("CANCELLED", "The import was cancelled.");
      return { ...r, ...extra, status, ...(detail !== undefined ? { detail } : {}) };
    });
  }

  private async pipeline(id: string, signal: AbortSignal): Promise<void> {
    let step = "validating";
    try {
      await this.status(id, "validating", "Checking the archive and project", { error: undefined });
      const zip = await this.store.readUpload(id);
      const { files, report } = validateProject(zip);
      signal.throwIfAborted();
      const fileMap = new Map(files.map((f) => [f.path, f.data]));
      const sourceHash = await this.store.putSource(fileMap);
      // Retries reuse the base version built from the same upload.
      const existing = (await this.store.listVersions(id)).find((v) => !v.parentVersionId && v.sourceHash === sourceHash);
      const version = existing ?? (await this.newVersion({ importId: id, sourceHash, files: fileMap, patchIds: [], changes: [] }));
      await this.status(id, "installing", "Installing dependencies in an isolated container", { report, baseVersionId: version.versionId });

      step = "installing";
      if (this.runtimeError || !this.runtime.available) await this.runtimeStatus();
      if (!this.runtime.available) throw new ImportError("RUNTIME_UNAVAILABLE", this.runtimeError?.message ?? "The isolation runtime is unavailable.", this.runtimeError?.hint);
      await this.buildVersion(version, fileMap, signal, async (phase) => {
        step = phase;
        if (phase === "building") await this.status(id, "building", "Building the app with vite build (no network)");
        if (phase === "starting") await this.status(id, "starting", "Starting the isolated preview");
      });
      const url = await this.runtime.ensurePreview(id, version.versionId, version.port);
      signal.throwIfAborted();
      const rec = await this.get(id);
      await this.status(id, rec.frozenTask ? "ready_to_test" : "ready_for_review", `Preview running at ${url}`);
    } catch (err) {
      const info = errorInfo(signal.aborted ? new ImportError("CANCELLED", "The import was cancelled.") : err);
      const logTail = (err as { logTail?: string }).logTail;
      await this.store
        .updateImport(id, (r) => ({
          ...r,
          status: info.code === "CANCELLED" ? "cancelled" : "failed",
          detail: undefined,
          error: { code: info.code, message: info.message, ...(info.hint ? { hint: info.hint } : {}), step, ...(logTail ? { logTail } : {}) },
        }))
        .catch(() => {});
      const base = (await this.store.getImport(id))?.baseVersionId;
      if (base) await this.runtime.stopPreview(base).catch(() => {});
      this.log(`[${id}] ${info.code}: ${info.message}`);
    }
  }

  private async newVersion(args: { importId: string; parentVersionId?: string; sourceHash: string; files: ReadonlyMap<string, Buffer>; patchIds: string[]; changes: VersionRecord["changes"] }): Promise<VersionRecord> {
    const versionId = `ver_imp_${hex12()}`;
    const manifest = buildManifest({ versionId, ...(args.parentVersionId ? { parentVersionId: args.parentVersionId } : {}), sourceHash: args.sourceHash, files: args.files });
    const v: VersionRecord = {
      schemaVersion: "1.0.0",
      versionId,
      importId: args.importId,
      ...(args.parentVersionId ? { parentVersionId: args.parentVersionId } : {}),
      sourceHash: args.sourceHash,
      port: await this.store.allocatePort(),
      patchIds: args.patchIds,
      changes: args.changes,
      manifest,
      createdAt: now(),
    };
    await this.store.insertVersion(v);
    await this.store.setBuild(versionId, { status: "pending" });
    return v;
  }

  /** Install (cached per dependency set) and build one version; records the build state either way. */
  private async buildVersion(v: VersionRecord, files: ReadonlyMap<string, Buffer>, signal: AbortSignal, onPhase: (phase: "installing" | "building" | "starting") => Promise<void>): Promise<void> {
    try {
      await this.store.setBuild(v.versionId, { status: "installing" });
      await onPhase("installing");
      const volume = await this.runtime.install(v.importId, v.versionId, files, signal);
      await this.store.setBuild(v.versionId, { status: "building" });
      await onPhase("building");
      await this.runtime.build(v.importId, v.versionId, files, volume, signal);
      await this.store.setBuild(v.versionId, { status: "ready" });
      await onPhase("starting");
    } catch (err) {
      const info = errorInfo(signal.aborted ? new ImportError("CANCELLED", "Cancelled.") : err);
      const logTail = (err as { logTail?: string }).logTail;
      await this.store.setBuild(v.versionId, { status: info.code === "CANCELLED" ? "cancelled" : "failed", error: { code: info.code, message: info.message, ...(info.hint ? { hint: info.hint } : {}), ...(logTail ? { logTail } : {}) } });
      throw err;
    }
  }

  async cancel(id: string): Promise<ImportRecord> {
    const rec = await this.get(id);
    if (!["uploading", "validating", "installing", "building", "starting"].includes(rec.status)) {
      throw new ImportError("INVALID_STATE", `Import ${id} is ${rec.status}; only an import in progress can be cancelled.`);
    }
    await this.store.updateImport(id, (r) => ({ ...r, status: "cancelled", detail: undefined, error: { code: "CANCELLED", message: "Cancelled by the designer.", step: r.status } }));
    this.jobs.get(id)?.abort(new ImportError("CANCELLED", "Cancelled by the designer."));
    if (rec.baseVersionId) await this.runtime.stopPreview(rec.baseVersionId).catch(() => {});
    return this.get(id);
  }

  async retry(id: string): Promise<ImportRecord> {
    const rec = await this.get(id);
    if (rec.status !== "failed" && rec.status !== "cancelled") throw new ImportError("INVALID_STATE", `Import ${id} is ${rec.status}; only a failed or cancelled import can be retried.`);
    if (this.jobs.has(id)) throw new ImportError("INVALID_STATE", `Import ${id} is still stopping; retry in a moment.`);
    await this.store.updateImport(id, (r) => ({ ...r, status: "validating", attempt: r.attempt + 1, error: undefined, detail: "Retrying" }));
    this.launch(id);
    return this.get(id);
  }

  // ---------------------------------------------------------------- versions and previews

  async ownsVersion(versionId: string): Promise<boolean> {
    return (await this.store.getVersion(versionId)) !== undefined;
  }

  async version(versionId: string): Promise<VersionRecord> {
    const v = await this.store.getVersion(versionId);
    if (!v) throw new ImportError("NOT_FOUND", `Imported version ${versionId} not found.`);
    return v;
  }

  /** The version's stable preview origin, starting its container if needed. */
  async ensurePreview(versionId: string): Promise<string> {
    const v = await this.version(versionId);
    const build = await this.store.getBuild(versionId);
    if (build?.status !== "ready") throw new ImportError("PREVIEW_FAILED", `Version ${versionId} has no successful build (${build?.status ?? "unknown"}).`);
    return this.runtime.ensurePreview(v.importId, versionId, v.port);
  }

  previewUrl(v: VersionRecord): string {
    return this.runtime.url(v.port);
  }

  // ---------------------------------------------------------------- task, verification, freezing

  async saveTask(id: string, draft: ImportTaskDraft): Promise<ImportRecord> {
    const parsed = ImportTask.safeParse(draft);
    if (!parsed.success) throw new ImportError("INVALID_TASK", parsed.error.issues.map((i) => `${i.path.join(".") || "task"}: ${i.message}`).join("; "));
    const rec = await this.get(id);
    if (rec.status !== "ready_for_review" && rec.status !== "ready_to_test") throw new ImportError("INVALID_STATE", `Import ${id} is ${rec.status}; the preview must be ready first.`);
    const task = parsed.data;
    return this.store.updateImport(id, (r) => {
      const frozenStillCurrent = r.frozenTask && r.task && draftHash(r.task) === draftHash(task);
      return {
        ...r,
        task,
        ...(r.verification && r.verification.taskHash !== draftHash(task) ? { verification: undefined } : {}),
        // Editing the task after freezing means the next experiment needs a new verification and freeze.
        ...(frozenStillCurrent ? {} : { frozenTask: undefined, status: "ready_for_review" as const }),
      };
    });
  }

  /**
   * Opens the preview at the task's starting route and viewport in a fresh browser, records a screenshot, the
   * controls a simulated user would see, and what each success check says right now. Checks that already pass
   * before anyone acts cannot tell success apart, so they block freezing.
   */
  async verify(id: string): Promise<Verification> {
    const rec = await this.get(id);
    if (!rec.task) throw new ImportError("INVALID_STATE", "Save a task before verifying it.");
    if (!rec.baseVersionId) throw new ImportError("INVALID_STATE", "The import has no built version yet.");
    const task = rec.task;
    const origin = await this.ensurePreview(rec.baseVersionId);
    const url = new URL(task.startRoute, origin).href;
    const blockers: string[] = [];
    const warnings: string[] = [];
    const shotDir = path.join(this.opts.artifactsDir, "imports", id);
    await mkdir(shotDir, { recursive: true });
    const shotPath = path.join(shotDir, `verify-${Date.now()}.png`);
    const allow = previewRequestPolicy(origin);
    const session = await openBrowserSession({ url, signal: AbortSignal.timeout(60_000), viewport: task.viewport, discovery: true, allowRequest: allow });
    let controls: Verification["controls"] = [];
    let checks: Verification["checks"] = [];
    try {
      await waitForDiscoveryReady(session.page);
      const found = await discoverControls(session.page);
      controls = found.map((c) => ({ ref: c.elementId, role: c.role, label: c.label }));
      await session.page.screenshot({ path: shotPath, scale: "css", animations: "disabled" });
      const result = await evaluateChecks(session.page, task.successChecks, "run_verification");
      checks = task.successChecks.map((c, i) => ({ name: checkName(c), description: describeCheck(c), passedAtStart: result.checks[i]!.passed, detail: result.checks[i]!.detail }));
      if (new URL(session.page.url()).pathname !== new URL(url).pathname) warnings.push(`The app moved from ${task.startRoute} to ${new URL(session.page.url()).pathname} on load.`);
    } finally {
      await session.close();
    }
    if (controls.length === 0) blockers.push("No controls a simulated user could act on were found at the starting route.");
    if (checks.length > 0 && checks.every((c) => c.passedAtStart)) blockers.push("Every success check already passes at the starting route, so they cannot tell success apart from doing nothing. Make at least one check specific to the finished task.");
    else for (const c of checks.filter((c) => c.passedAtStart)) warnings.push(`“${c.name}” already passes at the start; it adds no evidence on its own.`);
    const base = await this.version(rec.baseVersionId);
    const prot = protectedByTask(base.manifest, task);
    if (prot.length) warnings.push(`${prot.length} text element(s) are locked because a success check or your protected list uses them.`);
    if (base.manifest.elements.every((e) => e.supportedOps.length === 0)) warnings.push("No editable text was found, so GhostLoop can test but not propose changes.");
    const shot = { uri: shotPath, width: task.viewport.width, height: task.viewport.height };
    const published = this.opts.publishScreenshot ? await this.opts.publishScreenshot(shot) : shot;
    const verification: Verification = { taskHash: draftHash(task), ok: blockers.length === 0, at: now(), screenshot: published.uri, url, controls, checks, blockers, warnings };
    await this.store.updateImport(id, (r) => ({ ...r, verification }));
    return verification;
  }

  /** Freezes the verified task (immutable, content-hashed, outside any source tree). */
  async freeze(id: string): Promise<ImportRecord> {
    const rec = await this.get(id);
    if (!rec.task || !rec.baseVersionId) throw new ImportError("INVALID_STATE", "Save and verify a task first.");
    if (!rec.verification || rec.verification.taskHash !== draftHash(rec.task)) throw new ImportError("INVALID_STATE", "Verify this exact task before freezing it.");
    if (!rec.verification.ok) throw new ImportError("INVALID_STATE", `Verification found blockers: ${rec.verification.blockers.join(" ")}`);
    const frozen = FrozenTask.parse({ schemaVersion: "1.0.0", importId: id, baseVersionId: rec.baseVersionId, task: rec.task, frozenAt: now() });
    const hash = await this.store.putFrozenTask(frozen);
    return this.store.updateImport(id, (r) => ({ ...r, status: "ready_to_test", frozenTask: { hash, frozenAt: frozen.frozenAt } }));
  }

  async frozenTask(hash: string): Promise<FrozenTask> {
    const t = await this.store.getFrozenTask(hash);
    if (!t) throw new ImportError("NOT_FOUND", `Frozen task ${hash} not found.`);
    return t;
  }

  /**
   * Creates and starts a baseline experiment under the frozen task through the optimizer's own commands. The
   * protocol is built here, server-side, so the success definition, viewport and protections cannot be altered
   * by the caller.
   */
  async startExperiment(id: string, o: StartExperimentOptions): Promise<{ experimentId: string }> {
    if (!this.commands) throw new ImportError("INVALID_STATE", "Experiments can only be started from the GhostLoop worker.");
    for (const [k, v, lo, hi] of [["trials", o.trials, 1, LIMITS.trials], ["maxSteps", o.maxSteps, 1, LIMITS.maxSteps]] as const) {
      if (!Number.isInteger(v) || v < lo || v > hi) throw new ImportError("INVALID_TASK", `${k} must be an integer from ${lo} to ${hi}.`);
    }
    if (!(o.maxUsd >= 0) || !(o.maxMinutes > 0) || !(o.minImprovementPp >= 0)) throw new ImportError("INVALID_TASK", "Limits must be positive numbers.");
    const rec = await this.get(id);
    if (rec.status !== "ready_to_test" || !rec.frozenTask || !rec.baseVersionId) throw new ImportError("INVALID_STATE", "Verify and freeze the task first.");
    const frozen = await this.frozenTask(rec.frozenTask.hash);
    const base = await this.version(frozen.baseVersionId);
    const origin = await this.ensurePreview(base.versionId);
    const task = frozen.task;
    const personas = task.personas.length ? task.personas : DEFAULT_PERSONAS;
    const runs = allocate(o.trials, personas.length);
    const prot = protectedByTask(base.manifest, task);
    const protocol = ExperimentProtocolDraft.parse({
      schemaVersion: SCHEMA_VERSION,
      baseVersionId: base.versionId,
      task: task.task,
      hiddenGoalRef: taskRef(rec.frozenTask.hash),
      allowedPaths: [],
      intentConstraints: [
        ...task.protectedBehavior,
        "Only visible wording may change; routes, navigation, forms, validation and state stay as they are.",
        "Never change text that the success checks look for.",
      ],
      protectedElements: prot.map((p) => p.elementId),
      protectedCategories: ["checker"],
      approvedStyleTokens: [],
      mode: "manual",
      scenarios: personas
        .map((p, i) => ({ id: `scn_persona${i + 1}`, name: p.name, description: p.description, inputs: { ...task.inputs }, runs: runs[i] ?? 0 }))
        .filter((s) => s.runs > 0),
      budgets: {
        maxActionsPerRun: o.maxSteps,
        runsPerBatch: o.trials,
        maxConcurrency: Math.min(2, o.trials),
        maxIterations: 1,
        maxCandidates: 1,
        maxInferenceUsd: o.maxUsd,
        maxWallClockMs: Math.round(o.maxMinutes * 60_000),
      },
      policy: { targetCompletionRate: 0.8, minImprovementPp: o.minImprovementPp, maxMedianActionsIncrease: 2, maxValidationErrorRateIncreasePp: 15, minValidFraction: 0.75, minValidPerScenario: 1 },
      vetoRules: [],
    });
    const created = await this.commands.createExperiment({ protocol, baseVersionUrl: new URL(task.startRoute, origin).href, baseManifestHash: base.manifest.manifestHash });
    if (!created.ok) throw new ImportError("INVALID_STATE", `${created.code}: ${created.message}`);
    const { experimentId } = created.value as { experimentId: string };
    await this.store.updateImport(id, (r) => ({ ...r, experiments: [...r.experiments, { experimentId, taskHash: rec.frozenTask!.hash, createdAt: now() }] }));
    const started = await this.commands.startExperiment({ experimentId });
    if (!started.ok) throw new ImportError("INVALID_STATE", `${started.code}: ${started.message}`);
    return { experimentId };
  }

  // ---------------------------------------------------------------- simulation

  /** The frozen task a batch runs under, verified by hash and matched to the version's import. */
  private async taskFor(hiddenGoalRef: string, versionId: string): Promise<{ frozen: FrozenTask; version: VersionRecord; hash: string }> {
    const hash = parseTaskRef(hiddenGoalRef);
    if (!hash) throw new ImportError("INVALID_STATE", `Imported versions need a frozen import task; got ${hiddenGoalRef}.`);
    const frozen = await this.frozenTask(hash);
    const version = await this.version(versionId);
    if (version.importId !== frozen.importId) throw new ImportError("INVALID_STATE", `Version ${versionId} does not belong to the import the task was frozen for.`);
    return { frozen, version, hash };
  }

  /** Simulator integration for a batch on an imported version (baseline or candidate), under the frozen task. */
  async integrationFor(req: BatchRequest): Promise<AppIntegration> {
    const { frozen, version } = await this.taskFor(req.hiddenGoalRef, req.versionId);
    if (req.task !== frozen.task.task) throw new ImportError("INVALID_STATE", "The batch task differs from the frozen task wording.");
    const origin = await this.ensurePreview(version.versionId);
    return importedIntegration({ versionId: version.versionId, origin, frozen, touch: () => this.runtime.touch(version.versionId) });
  }

  // ---------------------------------------------------------------- candidates

  private async experimentTask(experimentId: string): Promise<{ importId: string; hash: string; frozen: FrozenTask }> {
    for (const rec of await this.store.listImports()) {
      const link = rec.experiments.find((e) => e.experimentId === experimentId);
      if (link) return { importId: rec.id, hash: link.taskHash, frozen: await this.frozenTask(link.taskHash) };
    }
    throw new ImportError("NOT_FOUND", `Experiment ${experimentId} was not started from an import.`);
  }

  /** Imported-app `CandidateAdapter`. Only approved `set_label` patches are applied; the parent is never touched. */
  candidateAdapter(): CandidateAdapter {
    return {
      getManifest: async (versionId) => toDesignManifest((await this.version(versionId)).manifest),
      createCandidate: (sourceVersionId, patches) => this.createCandidate(sourceVersionId, patches),
      validateCandidate: (candidateId) => this.validateCandidate(candidateId),
    };
  }

  async createCandidate(sourceVersionId: string, patches: MutationPatch[]): Promise<CandidateDesign> {
    const experimentIds = [...new Set(patches.map((p) => p.experimentId))];
    if (experimentIds.length !== 1) throw new ImportError("PATCH_REJECTED", "Every approved patch must come from one experiment.");
    const { importId, hash, frozen } = await this.experimentTask(experimentIds[0]!);
    const parent = await this.version(sourceVersionId);
    if (parent.importId !== importId) throw new ImportError("PATCH_REJECTED", `Version ${sourceVersionId} is not from this experiment's import.`);
    const parentFiles = await this.store.readSource(parent.sourceHash);
    const locked = new Set(protectedByTask(parent.manifest, frozen.task).map((p) => p.elementId));
    const { files, changes } = applyLabelPatches(parentFiles, parent.manifest, patches, { protectedElementIds: locked });
    const sourceHash = await this.store.putSource(files);
    const version = await this.newVersion({ importId, parentVersionId: parent.versionId, sourceHash, files, patchIds: patches.map((p) => p.id), changes });
    const candidate = CandidateDesign.parse({
      schemaVersion: SCHEMA_VERSION,
      id: newId("cand"),
      versionId: version.versionId,
      parentVersionId: parent.versionId,
      patchIds: patches.map((p) => p.id),
      url: new URL(frozen.task.startRoute, this.previewUrl(version)).href,
      reviewStatus: "pending",
      createdAt: now(),
    });
    await this.store.insertCandidate({ candidate, importId, experimentId: experimentIds[0]!, taskHash: hash, patches });
    // Build now so validation can smoke-test it; a failed build is reported by validateCandidate, not thrown here.
    const controller = new AbortController();
    try {
      await this.buildVersion(version, files, controller.signal, async () => {});
      await this.runtime.ensurePreview(importId, version.versionId, version.port);
    } catch (err) {
      this.log(`[${importId}] candidate ${candidate.id} build failed: ${errorInfo(err).message}`);
    }
    return candidate;
  }

  async validateCandidate(candidateId: string): Promise<ValidationResult> {
    const rec = await this.store.getCandidate(candidateId);
    if (!rec) throw new ImportError("NOT_FOUND", `Imported candidate ${candidateId} not found.`);
    const { candidate } = rec;
    const checks: ValidationCheck[] = [];
    const pass = (name: string, kind: ValidationCheck["kind"], detail: string): ValidationCheck => ({ name, kind, passed: true, detail });
    const fail = (name: string, kind: ValidationCheck["kind"], detail: string): ValidationCheck => ({ name, kind, passed: false, detail });

    const version = await this.version(candidate.versionId);
    const parent = await this.version(candidate.parentVersionId);
    const build = await this.store.getBuild(version.versionId);
    checks.push(build?.status === "ready" ? pass("build", "runnable", "vite build succeeded in the sandbox") : fail("build", "runnable", `${build?.error?.message ?? `build ${build?.status ?? "missing"}`}${build?.error?.logTail ? `\n${build.error.logTail.slice(-1500)}` : ""}`));

    // Source guardrails do not need a running app.
    let frozen: FrozenTask | undefined;
    try {
      frozen = await this.frozenTask(rec.taskHash);
      checks.push(pass("success_checks_unchanged", "guardrail", `frozen task ${rec.taskHash.slice(0, 12)} intact; ${frozen.task.successChecks.length} check(s) kept outside the candidate's source`));
    } catch (err) {
      checks.push(fail("success_checks_unchanged", "guardrail", errorInfo(err).message));
    }
    const parentFiles = await this.store.readSource(parent.sourceHash);
    const candidateFiles = await this.store.readSource(version.sourceHash);
    try {
      const locked = new Set(frozen ? protectedByTask(parent.manifest, frozen.task).map((p) => p.elementId) : []);
      const expected = applyLabelPatches(parentFiles, parent.manifest, rec.patches, { protectedElementIds: locked });
      const problems = diffAgainstParent({ expectedFiles: expected.files, candidateFiles, parent: parent.manifest, candidate: version.manifest, changes: expected.changes });
      checks.push(problems.length === 0 ? pass("only_approved_text_changed", "guardrail", expected.changes.map((c) => `${c.file}:${c.line} “${c.before}” → “${c.after}”`).join("; ")) : fail("only_approved_text_changed", "guardrail", problems.join("; ")));
      const touched = new Set(expected.changes.map((c) => c.elementId));
      const hit = [...locked].filter((e) => touched.has(e));
      checks.push(hit.length === 0 ? pass("protected_text_unchanged", "guardrail", `${locked.size} protected text element(s) untouched`) : fail("protected_text_unchanged", "guardrail", `changed protected: ${hit.join(", ")}`));
    } catch (err) {
      checks.push(fail("only_approved_text_changed", "guardrail", errorInfo(err).message));
      checks.push(fail("protected_text_unchanged", "guardrail", "could not re-apply the approved patches"));
    }

    // Smoke test: candidate and parent at the frozen route and viewport, compared structurally.
    if (build?.status === "ready" && frozen) {
      try {
        const [candOrigin, parentOrigin] = await Promise.all([this.ensurePreview(version.versionId), this.ensurePreview(parent.versionId)]);
        const [cand, par] = [await this.smoke(candOrigin, frozen), await this.smoke(parentOrigin, frozen)];
        checks.push(cand.controls.length > 0 ? pass("start_route_renders", "runnable", `${frozen.task.startRoute} rendered ${cand.controls.length} control(s)`) : fail("start_route_renders", "runnable", `${frozen.task.startRoute} rendered no controls`));
        const roles = (xs: { role: string }[]) => xs.map((x) => x.role).sort().join(",");
        checks.push(roles(cand.controls) === roles(par.controls) ? pass("structure_preserved", "guardrail", `same ${par.controls.length} controls by role as ${parent.versionId} at ${frozen.task.startRoute}`) : fail("structure_preserved", "guardrail", `controls by role differ: parent [${roles(par.controls)}], candidate [${roles(cand.controls)}]`));
        checks.push(cand.checksPassAtStart ? fail("checks_not_satisfied_at_start", "guardrail", "every success check passes before any action on the candidate") : pass("checks_not_satisfied_at_start", "guardrail", "success still requires completing the task"));
        const visible = version.changes.filter((c) => par.text.includes(c.before.toLowerCase()));
        const missing = visible.filter((c) => !cand.text.includes(c.after.toLowerCase()));
        checks.push(missing.length === 0 ? pass("approved_text_rendered", "guardrail", visible.length ? `${visible.length} change(s) visible at ${frozen.task.startRoute}` : `changes are not on ${frozen.task.startRoute}; verified in source`) : fail("approved_text_rendered", "guardrail", `not rendered: ${missing.map((m) => `“${m.after}”`).join(", ")}`));
      } catch (err) {
        checks.push(fail("start_route_renders", "runnable", errorInfo(err).message));
      }
    } else {
      checks.push(fail("start_route_renders", "runnable", build?.status === "ready" ? "frozen task unavailable" : "skipped: the candidate did not build"));
    }
    return ValidationResult.parse({ schemaVersion: SCHEMA_VERSION, id: newId("val"), candidateId, ok: checks.every((c) => c.passed), checks, at: now() });
  }

  private async smoke(origin: string, frozen: FrozenTask): Promise<{ controls: { role: string; label: string }[]; text: string; checksPassAtStart: boolean }> {
    const session = await openBrowserSession({ url: new URL(frozen.task.startRoute, origin).href, signal: AbortSignal.timeout(60_000), viewport: frozen.task.viewport, discovery: true, allowRequest: previewRequestPolicy(origin) });
    try {
      await waitForDiscoveryReady(session.page);
      const controls = (await discoverControls(session.page)).map((c) => ({ role: c.role, label: c.label }));
      const text = ((await session.page.evaluate("document.body ? document.body.innerText : ''")) as string).replace(/\s+/g, " ").toLowerCase();
      const result = await evaluateChecks(session.page, frozen.task.successChecks, "run_smoke");
      return { controls, text, checksPassAtStart: result.achieved };
    } finally {
      await session.close();
    }
  }

  /** What the dashboard shows about one version: manifest with source locations, build state, preview URL. */
  async versionView(versionId: string): Promise<{ version: VersionRecord; build: unknown; previewUrl: string; manifest: ImportedManifest }> {
    const v = await this.version(versionId);
    return { version: v, build: await this.store.getBuild(versionId), previewUrl: this.previewUrl(v), manifest: v.manifest };
  }

  static readonly CHECK_CAVEAT = CHECK_CAVEAT;
}
