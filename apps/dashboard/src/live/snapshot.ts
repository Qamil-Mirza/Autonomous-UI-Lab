import { z } from "zod"
import {
  AgentActionEvent,
  AgentRunResultObject,
  BatchRecord,
  CandidateDesign,
  DesignFeedbackPacket,
  DesignVersion,
  Evaluation,
  Experiment,
  Hypothesis,
  MutationPatch,
  ObservationTrend,
  ValidationResult,
} from "@ghostloop/contracts"
import { parseRow } from "@ghostloop/db"

/** A run as stored: the worker keeps its events in `agent_action`, not in the run row. */
export const StoredRun = AgentRunResultObject.omit({ events: true })
export type StoredRun = z.infer<typeof StoredRun>

/** Every record the dashboard reads, parsed from the row `json` columns. */
export interface Snapshot {
  experiments: Experiment[]
  versions: DesignVersion[]
  batches: BatchRecord[]
  runs: StoredRun[]
  actions: AgentActionEvent[]
  observations: ObservationTrend[]
  hypotheses: Hypothesis[]
  packets: DesignFeedbackPacket[]
  patches: MutationPatch[]
  candidates: CandidateDesign[]
  validations: ValidationResult[]
  evaluations: Evaluation[]
  /** Rows that failed to parse, as `table id: issues`; shown, never fatal. */
  invalid: string[]
}

type Row = { json: string }
type Iterable<T> = { iter(): IterableIterator<T> }

/** Structural view of `conn.db` (only what is read here), so tests can pass plain arrays. */
export interface SnapshotSource {
  experiment: Iterable<Row & { id: string }>
  designVersion: Iterable<Row & { id: string }>
  batch: Iterable<Row & { id: string }>
  agentRun: Iterable<Row & { id: string }>
  agentAction: Iterable<Row & { key: string }>
  observation: Iterable<Row & { id: string }>
  hypothesis: Iterable<Row & { id: string }>
  packet: Iterable<Row & { id: string }>
  patch: Iterable<Row & { id: string }>
  candidate: Iterable<Row & { id: string }>
  validation: Iterable<Row & { candidateId: string }>
  evaluation: Iterable<Row & { id: string }>
}

export function readSnapshot(db: SnapshotSource): Snapshot {
  const invalid: string[] = []
  function read<S extends z.ZodTypeAny>(
    schema: S,
    table: string,
    rows: Iterable<Row>,
    idOf: (row: Row) => string,
  ): z.infer<S>[] {
    const out: z.infer<S>[] = []
    for (const row of rows.iter()) {
      try {
        out.push(parseRow(schema, table, idOf(row), row.json))
      } catch (e) {
        invalid.push(e instanceof Error ? e.message : String(e))
      }
    }
    return out
  }
  const byId = (row: Row) => (row as Row & { id: string }).id
  return {
    experiments: read(Experiment, "experiment", db.experiment, byId),
    versions: read(DesignVersion, "design_version", db.designVersion, byId),
    batches: read(BatchRecord, "batch", db.batch, byId),
    runs: read(StoredRun, "agent_run", db.agentRun, byId),
    actions: read(AgentActionEvent, "agent_action", db.agentAction, (r) => (r as Row & { key: string }).key),
    observations: read(ObservationTrend, "observation", db.observation, byId),
    hypotheses: read(Hypothesis, "hypothesis", db.hypothesis, byId),
    packets: read(DesignFeedbackPacket, "packet", db.packet, byId),
    patches: read(MutationPatch, "patch", db.patch, byId),
    candidates: read(CandidateDesign, "candidate", db.candidate, byId),
    validations: read(ValidationResult, "validation", db.validation, (r) => (r as Row & { candidateId: string }).candidateId),
    evaluations: read(Evaluation, "evaluation", db.evaluation, byId),
    invalid,
  }
}

export const emptySnapshot = (): Snapshot => ({
  experiments: [],
  versions: [],
  batches: [],
  runs: [],
  actions: [],
  observations: [],
  hypotheses: [],
  packets: [],
  patches: [],
  candidates: [],
  validations: [],
  evaluations: [],
  invalid: [],
})
