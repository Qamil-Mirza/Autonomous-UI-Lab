import type {
  AgentActionEvent,
  AgentRunResult,
  Approval,
  BatchRecord,
  CandidateDesign,
  DesignFeedbackPacket,
  DesignVersion,
  Evaluation,
  Experiment,
  Hypothesis,
  MutationPatch,
  ValidationResult,
  ObservationDisposition,
  ObservationTrend,
} from "@ghostloop/contracts";

/**
 * Table names follow PRD §14 (`experiments` … `evaluations`) plus the extra record tables this slice needs
 * (`batches`, `approvals`, `packets`, `dispositions`). `onChange` listeners receive one of these.
 */
export type StoreTable =
  | "experiments"
  | "design_versions"
  | "agent_runs"
  | "agent_actions"
  | "observations"
  | "hypotheses"
  | "patches"
  | "candidates"
  | "evaluations"
  | "batches"
  | "approvals"
  | "packets"
  | "dispositions"
  | "validations";

export type ChangeListener = (table: StoreTable, key: string) => void;

/**
 * Persistence boundary for the optimizer. `InMemoryStore` implements it now; a SpacetimeDB adapter will later.
 * Every method is async so both backends share one shape. Readers always get copies, never live records.
 */
export interface ExperimentStore {
  getExperiment(id: string): Promise<Experiment | undefined>;
  putExperiment(e: Experiment): Promise<void>;
  /**
   * Addition for Task 10: atomic read-modify-write of one experiment (a reducer in SpacetimeDB). The controller and
   * the commands both write experiments while the other may be mid-await; separate get + put would lose updates
   * (e.g. a cancel flag overwritten by a stale controller write). Throws if the experiment does not exist.
   */
  updateExperiment(id: string, change: (e: Experiment) => Experiment): Promise<Experiment>;

  /** Design versions are insert-only (immutable lineage). Throws if the id already exists. */
  insertVersion(v: DesignVersion): Promise<void>;
  getVersion(id: string): Promise<DesignVersion | undefined>;

  putBatch(b: BatchRecord): Promise<void>;
  getBatch(id: string): Promise<BatchRecord | undefined>;

  /**
   * Stores the run record (idempotent by `runId`). The run's own `events` are inserted into the actions table with
   * the usual `(runId, seq)` dedupe; the stored run itself does not keep them.
   */
  putRun(r: AgentRunResult): Promise<void>;
  /** Runs of a batch with `events` rebuilt from `listActions(runId)`. */
  listRuns(batchId: string): Promise<AgentRunResult[]>;

  /** Returns false (and writes nothing) when `(runId, seq)` already exists. */
  insertAction(e: AgentActionEvent): Promise<boolean>;
  /** Actions of one run in `seq` order. */
  listActions(runId: string): Promise<AgentActionEvent[]>;

  putObservations(obs: ObservationTrend[]): Promise<void>;
  listObservations(experimentId: string): Promise<ObservationTrend[]>;
  /** Addition to the Task 9 interface: single-observation lookup used by `SetObservationDisposition`. */
  getObservation(id: string): Promise<ObservationTrend | undefined>;

  /** Dispositions are app-wide, keyed by observation fingerprint (spec §5.3). */
  setDisposition(fingerprint: string, d: ObservationDisposition): Promise<void>;
  getDispositions(): Promise<Map<string, ObservationDisposition>>;

  putPatches(p: MutationPatch[]): Promise<void>;
  listPatches(experimentId: string, round: number): Promise<MutationPatch[]>;
  getPatch(id: string): Promise<MutationPatch | undefined>;
  /** Merges `changes` into an existing patch (the id is kept). Throws if the patch does not exist. */
  updatePatch(id: string, changes: Partial<MutationPatch>): Promise<void>;

  putHypotheses(h: Hypothesis[]): Promise<void>;
  putPacket(p: DesignFeedbackPacket): Promise<void>;

  /** Approvals are insert-only: one per experiment and round. Throws if one already exists. */
  putApproval(a: Approval): Promise<void>;
  getApproval(experimentId: string, round: number): Promise<Approval | undefined>;

  /**
   * Stores a candidate under its owning experiment (ruling R7: ownership is recorded by the caller, never inferred
   * from C-supplied `patchIds` or evaluations). Updating keeps the original owner; throws if `experimentId` differs.
   */
  putCandidate(experimentId: string, c: CandidateDesign): Promise<void>;
  getCandidate(id: string): Promise<CandidateDesign | undefined>;
  /** Addition to the Task 9 interface: the experiment that owns a candidate, as recorded by `putCandidate`. */
  getCandidateExperimentId(candidateId: string): Promise<string | undefined>;
  /** Candidates whose recorded owner (from `putCandidate`) is `experimentId`. */
  listCandidates(experimentId: string): Promise<CandidateDesign[]>;

  /** Addition for Task 10: C's validation result per candidate, so `comparing` can resume with its guardrails. */
  putValidation(v: ValidationResult): Promise<void>;
  getValidation(candidateId: string): Promise<ValidationResult | undefined>;

  putEvaluation(e: Evaluation): Promise<void>;
  getEvaluation(id: string): Promise<Evaluation | undefined>;
  listEvaluations(experimentId: string): Promise<Evaluation[]>;

  /** Fires `(table, key)` after every write. Returns an unsubscribe function. */
  onChange(fn: ChangeListener): () => void;
}

type StoredRun = Omit<AgentRunResult, "events">;

const clone = <T>(v: T): T => structuredClone(v);
const actionKey = (runId: string, seq: number) => `${runId}:${seq}`;
const approvalKey = (experimentId: string, round: number) => `${experimentId}:${round}`;

export class InMemoryStore implements ExperimentStore {
  private experiments = new Map<string, Experiment>();
  private versions = new Map<string, DesignVersion>();
  private batches = new Map<string, BatchRecord>();
  private runs = new Map<string, StoredRun>();
  private actions = new Map<string, AgentActionEvent>();
  private observations = new Map<string, ObservationTrend>();
  private dispositions = new Map<string, ObservationDisposition>();
  private patches = new Map<string, MutationPatch>();
  private hypotheses = new Map<string, Hypothesis>();
  private packets = new Map<string, DesignFeedbackPacket>();
  private approvals = new Map<string, Approval>();
  private candidates = new Map<string, CandidateDesign>();
  private candidateOwners = new Map<string, string>();
  private evaluations = new Map<string, Evaluation>();
  private validations = new Map<string, ValidationResult>();
  private listeners = new Set<ChangeListener>();

  private emit(table: StoreTable, key: string): void {
    for (const fn of [...this.listeners]) fn(table, key);
  }

  async getExperiment(id: string) {
    return clone(this.experiments.get(id));
  }
  async putExperiment(e: Experiment) {
    this.experiments.set(e.id, clone(e));
    this.emit("experiments", e.id);
  }
  async updateExperiment(id: string, change: (e: Experiment) => Experiment) {
    const current = this.experiments.get(id);
    if (!current) throw new Error(`experiment ${id} not found`);
    const next = change(clone(current));
    if (next.id !== id) throw new Error(`updateExperiment cannot change the id (${id} -> ${next.id})`);
    this.experiments.set(id, clone(next));
    this.emit("experiments", id);
    return clone(next);
  }

  async insertVersion(v: DesignVersion) {
    if (this.versions.has(v.id)) throw new Error(`design version ${v.id} already exists (versions are immutable)`);
    this.versions.set(v.id, clone(v));
    this.emit("design_versions", v.id);
  }
  async getVersion(id: string) {
    return clone(this.versions.get(id));
  }

  async putBatch(b: BatchRecord) {
    this.batches.set(b.batchId, clone(b));
    this.emit("batches", b.batchId);
  }
  async getBatch(id: string) {
    return clone(this.batches.get(id));
  }

  async putRun(r: AgentRunResult) {
    const { events, ...run } = r;
    this.runs.set(run.runId, clone(run));
    this.emit("agent_runs", run.runId);
    for (const e of events) await this.insertAction(e);
  }
  async listRuns(batchId: string) {
    const out: AgentRunResult[] = [];
    for (const run of this.runs.values()) {
      if (run.batchId !== batchId) continue;
      out.push({ ...clone(run), events: await this.listActions(run.runId) });
    }
    return out;
  }

  async insertAction(e: AgentActionEvent) {
    const key = actionKey(e.runId, e.seq);
    if (this.actions.has(key)) return false;
    this.actions.set(key, clone(e));
    this.emit("agent_actions", key);
    return true;
  }
  async listActions(runId: string) {
    return [...this.actions.values()]
      .filter((e) => e.runId === runId)
      .sort((a, b) => a.seq - b.seq)
      .map(clone);
  }

  async putObservations(obs: ObservationTrend[]) {
    for (const o of obs) {
      this.observations.set(o.id, clone(o));
      this.emit("observations", o.id);
    }
  }
  async listObservations(experimentId: string) {
    return [...this.observations.values()].filter((o) => o.experimentId === experimentId).map(clone);
  }
  async getObservation(id: string) {
    return clone(this.observations.get(id));
  }

  async setDisposition(fingerprint: string, d: ObservationDisposition) {
    this.dispositions.set(fingerprint, d);
    this.emit("dispositions", fingerprint);
  }
  async getDispositions() {
    return new Map(this.dispositions);
  }

  async putPatches(p: MutationPatch[]) {
    for (const x of p) {
      this.patches.set(x.id, clone(x));
      this.emit("patches", x.id);
    }
  }
  async listPatches(experimentId: string, round: number) {
    return [...this.patches.values()].filter((p) => p.experimentId === experimentId && p.round === round).map(clone);
  }
  async getPatch(id: string) {
    return clone(this.patches.get(id));
  }
  async updatePatch(id: string, changes: Partial<MutationPatch>) {
    const p = this.patches.get(id);
    if (!p) throw new Error(`patch ${id} not found`);
    this.patches.set(id, clone({ ...p, ...changes, id } as MutationPatch));
    this.emit("patches", id);
  }

  async putHypotheses(h: Hypothesis[]) {
    for (const x of h) {
      this.hypotheses.set(x.id, clone(x));
      this.emit("hypotheses", x.id);
    }
  }
  async putPacket(p: DesignFeedbackPacket) {
    this.packets.set(p.id, clone(p));
    this.emit("packets", p.id);
  }

  async putApproval(a: Approval) {
    const key = approvalKey(a.experimentId, a.round);
    if (this.approvals.has(key)) throw new Error(`approval for ${a.experimentId} round ${a.round} already exists (approvals are insert-only)`);
    this.approvals.set(key, clone(a));
    this.emit("approvals", key);
  }
  async getApproval(experimentId: string, round: number) {
    return clone(this.approvals.get(approvalKey(experimentId, round)));
  }

  async putCandidate(experimentId: string, c: CandidateDesign) {
    const owner = this.candidateOwners.get(c.id);
    if (owner !== undefined && owner !== experimentId) {
      throw new Error(`candidate ${c.id} belongs to experiment ${owner}, not ${experimentId}`);
    }
    this.candidateOwners.set(c.id, experimentId);
    this.candidates.set(c.id, clone(c));
    this.emit("candidates", c.id);
  }
  async getCandidate(id: string) {
    return clone(this.candidates.get(id));
  }
  async getCandidateExperimentId(candidateId: string) {
    return this.candidateOwners.get(candidateId);
  }
  async listCandidates(experimentId: string) {
    return [...this.candidates.values()].filter((c) => this.candidateOwners.get(c.id) === experimentId).map(clone);
  }

  async putValidation(v: ValidationResult) {
    this.validations.set(v.candidateId, clone(v));
    this.emit("validations", v.candidateId);
  }
  async getValidation(candidateId: string) {
    return clone(this.validations.get(candidateId));
  }

  async putEvaluation(e: Evaluation) {
    this.evaluations.set(e.id, clone(e));
    this.emit("evaluations", e.id);
  }
  async getEvaluation(id: string) {
    return clone(this.evaluations.get(id));
  }
  async listEvaluations(experimentId: string) {
    return [...this.evaluations.values()].filter((e) => e.experimentId === experimentId).map(clone);
  }

  onChange(fn: ChangeListener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}
