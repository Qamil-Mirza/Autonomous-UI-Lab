import { z } from "zod";

export const RunOutcome = z.enum(["goal", "agent_stop", "step_limit", "flow_blocked", "model_error", "browser_error", "user_cancelled"]);
export type RunOutcome = z.infer<typeof RunOutcome>;

export const BEHAVIORAL_OUTCOMES = ["goal", "agent_stop", "step_limit", "flow_blocked"] as const satisfies readonly RunOutcome[];
export const INFRA_OUTCOMES = ["model_error", "browser_error"] as const satisfies readonly RunOutcome[];

export const ActionType = z.enum(["click", "type", "select", "stop"]);
export type ActionType = z.infer<typeof ActionType>;

export const ActionResult = z.enum(["ok", "validation_error", "no_effect", "rejected_invalid"]);
export type ActionResult = z.infer<typeof ActionResult>;

export const ExperimentState = z.enum([
  "created", "baseline_running", "observing", "diagnosing", "proposing", "awaiting_approval", "patching",
  "validating", "candidate_running", "comparing", "accepted", "rejected", "inconclusive", "stopped",
]);
export type ExperimentState = z.infer<typeof ExperimentState>;

export const StoppingReason = z.enum([
  "TARGET_MET", "ITERATION_BUDGET", "COST_BUDGET", "TIME_BUDGET", "NO_VALID_PATCH",
  "NO_MEASURED_IMPROVEMENT", "INCONCLUSIVE", "USER_STOP", "INTEGRATION_FAILURE",
]);
export type StoppingReason = z.infer<typeof StoppingReason>;

export const ReviewMode = z.enum(["manual", "auto"]);
export type ReviewMode = z.infer<typeof ReviewMode>;

export const MutationOp = z.enum(["set_label", "set_style_token", "set_order", "set_visibility"]);
export type MutationOp = z.infer<typeof MutationOp>;

export const RiskClass = z.enum(["low", "review_required", "blocked", "unknown"]);
export type RiskClass = z.infer<typeof RiskClass>;

export const PatchState = z.enum(["proposed", "blocked", "approved", "declined", "applied"]);
export type PatchState = z.infer<typeof PatchState>;

export const ObservationDisposition = z.enum(["unreviewed", "confirmed", "intentional", "not_relevant"]);
export type ObservationDisposition = z.infer<typeof ObservationDisposition>;

export const EvaluationDecision = z.enum(["accepted", "rejected", "inconclusive"]);
export type EvaluationDecision = z.infer<typeof EvaluationDecision>;

export const CandidateReviewStatus = z.enum(["pending", "promoted_measured", "retained_aesthetic", "discarded"]);
export type CandidateReviewStatus = z.infer<typeof CandidateReviewStatus>;

export const FigmaStatus = z.enum(["verified", "pending", "mismatch", "unavailable"]);
export type FigmaStatus = z.infer<typeof FigmaStatus>;

export const ProtectedCategory = z.enum(["signup", "pricing", "auth", "consent", "validation", "checker"]);
export type ProtectedCategory = z.infer<typeof ProtectedCategory>;

export const CheckKind = z.enum(["runnable", "guardrail"]);
export type CheckKind = z.infer<typeof CheckKind>;
