import {
  AgentActionEvent,
  AgentRunResultObject,
  Approval,
  BatchRecord,
  CandidateDesign,
  DesignVersion,
  Evaluation,
  Experiment,
  MutationPatch,
  ObservationDisposition,
  ObservationTrend,
  ValidationResult,
  type AgentRunResult,
  type DesignFeedbackPacket,
  type Hypothesis,
} from "@ghostloop/contracts";
import { connect, parseRow, reducerErrorCode, type DbConnection, type EventContext, type ExperimentRow } from "@ghostloop/db";
import type { ChangeListener, ExperimentStore, StoreTable } from "./store";

/** Stored run records omit `events`; those live in `agent_action` (see `ExperimentStore.putRun`). */
const StoredRun = AgentRunResultObject.omit({ events: true });

const UPDATE_ATTEMPTS = 5;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Rethrows a module `ALREADY_EXISTS` rejection with the insert-only rule named, keeping the code first. */
async function insertOnly(write: Promise<void>, what: string): Promise<void> {
  try {
    await write;
  } catch (e) {
    if (reducerErrorCode(e) === "ALREADY_EXISTS") throw new Error(`${message(e)} (${what} are insert-only)`);
    throw e;
  }
}

/** The callback surface every generated table handle has. */
interface WatchedTable<R> {
  onInsert(cb: (ctx: EventContext, row: R) => void): void;
  onUpdate(cb: (ctx: EventContext, oldRow: R, row: R) => void): void;
  onDelete(cb: (ctx: EventContext, row: R) => void): void;
}

export interface SpacetimeStoreOptions {
  uri: string;
  database: string;
  token?: string;
  timeoutMs?: number;
  /**
   * Called once if the connection is lost after `open` resolved; not called for `close()`. The store does not
   * reconnect: pending and later writes reject with `DISCONNECTED: ...`, so the caller should stop (or reopen).
   */
  onDisconnect?: (err: Error) => void;
}

/**
 * `ExperimentStore` over the GhostLoop SpacetimeDB module (spec §3). Writes go through reducers; reads parse rows from
 * this connection's subscription cache with the contracts schemas. After an awaited reducer resolves, this
 * connection's cache already shows the write, so reads after writes are consistent within one store.
 */
export class SpacetimeStore implements ExperimentStore {
  private listeners = new Set<ChangeListener>();
  /** Tail of the in-process write queue per experiment id (see `serialize`). */
  private experimentQueues = new Map<string, Promise<unknown>>();
  /** Set once the connection is lost (see `lose`). */
  private lostError?: Error;
  /** Rejects when the connection is lost; every reducer call races it (see `reducers`). */
  private readonly lost: Promise<never>;
  private rejectLost!: (err: Error) => void;
  /**
   * `connection.reducers`, but each call rejects with `DISCONNECTED: ...` once the connection is lost: without
   * automatic reconnect the SDK leaves a call on a closed socket pending forever.
   */
  private readonly reducers: DbConnection["reducers"];

  private constructor(
    readonly connection: DbConnection,
    readonly token: string,
    private readonly onDisconnect?: (err: Error) => void,
  ) {
    this.lost = new Promise<never>((_, reject) => {
      this.rejectLost = reject;
    });
    this.lost.catch(() => {}); // nobody may be waiting when the connection drops
    this.reducers = new Proxy(connection.reducers, {
      get: (target, prop, receiver) => {
        const value: unknown = Reflect.get(target, prop, receiver);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          if (this.lostError) return Promise.reject(this.lostError);
          return Promise.race([(value as (...a: unknown[]) => Promise<unknown>).apply(target, args), this.lost]);
        };
      },
    });
    const db = connection.db;
    // Table callbacks run for this connection's writes before the reducer promise resolves, and for other
    // connections' writes when their updates arrive.
    this.watch(db.experiment, "experiments", (r) => r.id);
    this.watch(db.designVersion, "design_versions", (r) => r.id);
    this.watch(db.batch, "batches", (r) => r.id);
    this.watch(db.agentRun, "agent_runs", (r) => r.id);
    this.watch(db.agentAction, "agent_actions", (r) => r.key);
    this.watch(db.observation, "observations", (r) => r.id);
    this.watch(db.disposition, "dispositions", (r) => r.fingerprint);
    this.watch(db.hypothesis, "hypotheses", (r) => r.id);
    this.watch(db.packet, "packets", (r) => r.id);
    this.watch(db.patch, "patches", (r) => r.id);
    this.watch(db.approval, "approvals", (r) => r.key);
    this.watch(db.candidate, "candidates", (r) => r.id);
    this.watch(db.validation, "validations", (r) => r.candidateId);
    this.watch(db.evaluation, "evaluations", (r) => r.id);
  }

  /**
   * Connects, waits for the subscription to every table, and claims the writer slot. Rejects with `NOT_WRITER: ...`
   * when another identity already holds it.
   */
  static async open(opts: SpacetimeStoreOptions): Promise<SpacetimeStore> {
    // A drop before the store exists (during the writer claim) fails `open` instead.
    let store: SpacetimeStore | undefined;
    let failClaim!: (err: Error) => void;
    const claimLost = new Promise<never>((_, reject) => {
      failClaim = reject;
    });
    claimLost.catch(() => {});
    const { conn, token } = await connect({
      ...opts,
      onDisconnect: (err) => {
        if (store) return store.lose(err);
        failClaim(new Error(`DISCONNECTED: ${err.message}`));
      },
    });
    try {
      await Promise.race([conn.reducers.claimWriter({}), claimLost]);
    } catch (e) {
      conn.disconnect();
      if (reducerErrorCode(e) === "NOT_WRITER") {
        throw new Error(
          `NOT_WRITER: database ${opts.database} already has a writer with another identity. Reuse that writer's ` +
          `token, or reset the database with \`npm run stdb:publish:fresh\` (deletes all data). (${message(e)})`,
        );
      }
      throw e;
    }
    store = new SpacetimeStore(conn, token, opts.onDisconnect);
    return store;
  }

  /** Records a lost connection: fails pending and later writes, then tells the owner. */
  private lose(err: Error): void {
    if (this.lostError) return;
    this.lostError = new Error(`DISCONNECTED: ${err.message}`);
    this.rejectLost(this.lostError);
    try {
      this.onDisconnect?.(err);
    } catch {
      // the owner's handler must not break the SDK's event loop
    }
  }

  async close(): Promise<void> {
    this.connection.disconnect();
  }

  /** Deletes every domain and command row (writer only). For tests and demo resets. */
  async devReset(): Promise<void> {
    await this.reducers.devReset({});
  }

  private watch<R>(table: WatchedTable<R>, name: StoreTable, key: (row: R) => string): void {
    table.onInsert((_ctx, row) => this.emit(name, key(row)));
    table.onUpdate((_ctx, _old, row) => this.emit(name, key(row)));
    table.onDelete((_ctx, row) => this.emit(name, key(row)));
  }

  private emit(table: StoreTable, key: string): void {
    // A listener must never fail a store write: sync throws and async rejections are swallowed.
    for (const fn of [...this.listeners]) {
      try {
        const r: unknown = fn(table, key);
        if (r instanceof Promise) r.catch(() => {});
      } catch {
        // ignored
      }
    }
  }

  /** Runs experiment writes for one id one at a time within this process; a failed write does not block the next. */
  private serialize<T>(id: string, task: () => Promise<T>): Promise<T> {
    const run = (this.experimentQueues.get(id) ?? Promise.resolve()).then(task, task);
    const tail = run.catch(() => {});
    this.experimentQueues.set(id, tail);
    void tail.then(() => {
      if (this.experimentQueues.get(id) === tail) this.experimentQueues.delete(id);
    });
    return run;
  }

  private parseExperiment(row: ExperimentRow): Experiment {
    return parseRow(Experiment, "experiment", row.id, row.json);
  }

  private writeExperiment(e: Experiment, expectedRev: bigint): Promise<void> {
    return this.reducers.putExperiment({
      id: e.id,
      state: e.state,
      round: e.round.index,
      expectedRev,
      json: JSON.stringify(e),
    });
  }

  async getExperiment(id: string) {
    const row = this.connection.db.experiment.id.find(id);
    return row ? this.parseExperiment(row) : undefined;
  }
  async listExperiments() {
    return [...this.connection.db.experiment.iter()].map((r) => this.parseExperiment(r));
  }
  async putExperiment(e: Experiment) {
    await this.serialize(e.id, () => this.writeExperiment(e, this.connection.db.experiment.id.find(e.id)?.rev ?? 0n));
  }
  updateExperiment(id: string, change: (e: Experiment) => Experiment): Promise<Experiment> {
    return this.serialize(id, async () => {
      for (let attempt = 1; ; attempt++) {
        const row = this.connection.db.experiment.id.find(id);
        if (!row) throw new Error(`NOT_FOUND: experiment ${id} not found`);
        const next = change(this.parseExperiment(row));
        if (next.id !== id) throw new Error(`updateExperiment cannot change the id (${id} -> ${next.id})`);
        try {
          await this.writeExperiment(next, row.rev);
          return structuredClone(next);
        } catch (e) {
          if (reducerErrorCode(e) !== "STALE_REV") throw e;
          if (attempt === UPDATE_ATTEMPTS) throw new Error(`${message(e)} (gave up after ${UPDATE_ATTEMPTS} attempts)`);
          // Another writer moved the row: back off (growing, jittered) and wait for its write to reach our cache.
          await sleep(5 * 2 ** (attempt - 1) * (1 + Math.random()));
          for (let i = 0; i < 100 && this.connection.db.experiment.id.find(id)?.rev === row.rev; i++) await sleep(10);
        }
      }
    });
  }

  async insertVersion(v: DesignVersion) {
    await insertOnly(
      this.reducers.insertVersion({ id: v.id, parentId: v.parentVersionId ?? undefined, json: JSON.stringify(v) }),
      "versions",
    );
  }
  async getVersion(id: string) {
    const row = this.connection.db.designVersion.id.find(id);
    return row ? parseRow(DesignVersion, "design_version", row.id, row.json) : undefined;
  }

  async putBatch(b: BatchRecord) {
    await this.reducers.putBatch({ id: b.batchId, experimentId: b.experimentId, round: b.round, json: JSON.stringify(b) });
  }
  async getBatch(id: string) {
    const row = this.connection.db.batch.id.find(id);
    return row ? parseRow(BatchRecord, "batch", row.id, row.json) : undefined;
  }

  async putRun(r: AgentRunResult) {
    const { events, ...run } = r;
    await this.reducers.putRun({ id: run.runId, batchId: run.batchId, json: JSON.stringify(run) });
    for (const e of events) await this.insertAction(e);
  }
  async listRuns(batchId: string) {
    const out: AgentRunResult[] = [];
    for (const row of this.connection.db.agentRun.batchId.filter(batchId)) {
      const run = parseRow(StoredRun, "agent_run", row.id, row.json);
      out.push({ ...run, events: await this.listActions(run.runId) });
    }
    return out;
  }

  async insertAction(e: AgentActionEvent) {
    // The module is the dedupe guard: a duplicate insert is a no-op there. The boolean is best-effort, read from the
    // cache before the call, so two concurrent inserts of one key on this store can both return true.
    if (this.connection.db.agentAction.key.find(`${e.runId}:${e.seq}`)) return false;
    await this.reducers.insertAction({ runId: e.runId, seq: e.seq, json: JSON.stringify(e) });
    return true;
  }
  async listActions(runId: string) {
    return [...this.connection.db.agentAction.runId.filter(runId)]
      .sort((a, b) => a.seq - b.seq)
      .map((row) => parseRow(AgentActionEvent, "agent_action", row.key, row.json));
  }

  async putObservations(obs: ObservationTrend[]) {
    for (const o of obs) {
      await this.reducers.putObservation({ id: o.id, experimentId: o.experimentId, json: JSON.stringify(o) });
    }
  }
  async listObservations(experimentId: string) {
    return [...this.connection.db.observation.experimentId.filter(experimentId)].map((row) =>
      parseRow(ObservationTrend, "observation", row.id, row.json),
    );
  }
  async getObservation(id: string) {
    const row = this.connection.db.observation.id.find(id);
    return row ? parseRow(ObservationTrend, "observation", row.id, row.json) : undefined;
  }

  async setDisposition(fingerprint: string, d: ObservationDisposition) {
    await this.reducers.setDisposition({ fingerprint, disposition: d });
  }
  async getDispositions() {
    const out = new Map<string, ObservationDisposition>();
    for (const row of this.connection.db.disposition.iter()) {
      out.set(row.fingerprint, parseRow(ObservationDisposition, "disposition", row.fingerprint, JSON.stringify(row.disposition)));
    }
    return out;
  }

  async putPatches(p: MutationPatch[]) {
    for (const x of p) {
      await this.reducers.putPatch({
        id: x.id,
        experimentId: x.experimentId,
        round: x.round,
        state: x.state,
        json: JSON.stringify(x),
      });
    }
  }
  async listPatches(experimentId: string, round: number) {
    return [...this.connection.db.patch.experimentId.filter(experimentId)]
      .filter((row) => row.round === round)
      .map((row) => parseRow(MutationPatch, "patch", row.id, row.json));
  }
  async getPatch(id: string) {
    const row = this.connection.db.patch.id.find(id);
    return row ? parseRow(MutationPatch, "patch", row.id, row.json) : undefined;
  }
  async updatePatch(id: string, changes: Partial<MutationPatch>) {
    const p = await this.getPatch(id);
    if (!p) throw new Error(`NOT_FOUND: patch ${id} not found`);
    await this.putPatches([{ ...p, ...changes, id } as MutationPatch]);
  }

  async putHypotheses(h: Hypothesis[]) {
    for (const x of h) {
      await this.reducers.putHypothesis({
        id: x.id,
        experimentId: x.experimentId,
        round: x.round,
        json: JSON.stringify(x),
      });
    }
  }
  async putPacket(p: DesignFeedbackPacket) {
    // The packet contract has no round field, but the row needs one (an index helper only, never read back): use the
    // round of its first patch, else of its first hypothesis, else 0.
    const round = p.patches[0]?.round ?? p.hypotheses[0]?.round ?? 0;
    await this.reducers.putPacket({ id: p.id, experimentId: p.experimentId, round, json: JSON.stringify(p) });
  }

  async putApproval(a: Approval) {
    await insertOnly(
      this.reducers.putApproval({
        experimentId: a.experimentId,
        round: a.round,
        sourceVersionId: a.sourceVersionId,
        json: JSON.stringify(a),
      }),
      "approvals",
    );
  }
  async getApproval(experimentId: string, round: number) {
    const key = `${experimentId}:${round}`;
    const row = this.connection.db.approval.key.find(key);
    return row ? parseRow(Approval, "approval", key, row.json) : undefined;
  }

  async putCandidate(experimentId: string, c: CandidateDesign) {
    await this.reducers.putCandidate({ id: c.id, experimentId, json: JSON.stringify(c) });
  }
  async getCandidate(id: string) {
    const row = this.connection.db.candidate.id.find(id);
    return row ? parseRow(CandidateDesign, "candidate", row.id, row.json) : undefined;
  }
  async getCandidateExperimentId(candidateId: string) {
    return this.connection.db.candidate.id.find(candidateId)?.experimentId;
  }
  async listCandidates(experimentId: string) {
    return [...this.connection.db.candidate.experimentId.filter(experimentId)].map((row) =>
      parseRow(CandidateDesign, "candidate", row.id, row.json),
    );
  }

  async putValidation(v: ValidationResult) {
    await this.reducers.putValidation({ candidateId: v.candidateId, json: JSON.stringify(v) });
  }
  async getValidation(candidateId: string) {
    const row = this.connection.db.validation.candidateId.find(candidateId);
    return row ? parseRow(ValidationResult, "validation", row.candidateId, row.json) : undefined;
  }

  async putEvaluation(e: Evaluation) {
    await this.reducers.putEvaluation({ id: e.id, experimentId: e.experimentId, json: JSON.stringify(e) });
  }
  async getEvaluation(id: string) {
    const row = this.connection.db.evaluation.id.find(id);
    return row ? parseRow(Evaluation, "evaluation", row.id, row.json) : undefined;
  }
  async listEvaluations(experimentId: string) {
    return [...this.connection.db.evaluation.experimentId.filter(experimentId)].map((row) =>
      parseRow(Evaluation, "evaluation", row.id, row.json),
    );
  }

  onChange(fn: ChangeListener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}
