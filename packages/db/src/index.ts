export { connect, DEFAULT_DATABASE, DEFAULT_URI, type ConnectOptions, type Connected } from "./connect";
export { parseRow, reducerErrorCode, RowValidationError } from "./rows";
export { submitCommand } from "./commands";
export { DbConnection, tables, type EventContext, type SubscriptionHandle } from "./bindings";
// Row types carry a `Row` suffix so they do not clash with the contracts record types of the same name.
export type {
  AgentAction as AgentActionRow,
  AgentRun as AgentRunRow,
  Approval as ApprovalRow,
  Batch as BatchRow,
  Candidate as CandidateRow,
  Command as CommandRow,
  DesignVersion as DesignVersionRow,
  Disposition as DispositionRow,
  Evaluation as EvaluationRow,
  Experiment as ExperimentRow,
  Hypothesis as HypothesisRow,
  Observation as ObservationRow,
  Packet as PacketRow,
  Patch as PatchRow,
  Validation as ValidationRow,
  Writer as WriterRow,
} from "./bindings/types";
