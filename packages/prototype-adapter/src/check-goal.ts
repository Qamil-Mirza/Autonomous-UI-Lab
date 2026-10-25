import { GoalCheckResult, type GoalCheck } from "@ghostloop/contracts";
import { RunState } from "./state";
import { createRunStore, defaultRunsDir, InvalidRunIdError } from "./store";
import { isEmail, isFilled, isRunId, MIN_PASSWORD_LENGTH } from "./validation";

// The run was never initialized (or was deleted). A harness fault, not a failed goal.
export class RunNotFoundError extends Error {
  constructor(readonly runId: string) {
    super(`run ${runId} not found`);
    this.name = "RunNotFoundError";
  }
}

export const GOAL_CHECKS = ["account_created", "exactly_one_workspace", "free_plan_selected", "invite_sent", "no_paid_trial"] as const;

const check = (name: (typeof GOAL_CHECKS)[number], passed: boolean, detail: string): GoalCheck => ({ name, passed, detail });

// Pure evaluation of the demo goal: account, exactly one workspace on Free, one invite sent, no paid trial.
// Reads persisted state only; it never looks at the DOM, screen text or anything the agent claims.
export function evaluateGoal(state: RunState, now: Date = new Date()): GoalCheckResult {
  const { account, workspaces, plan, invites } = state;
  const accountProblems = !account
    ? ["no signup recorded"]
    : [
        !isFilled(account.name) && "name is blank",
        !isEmail(account.email) && `email ${JSON.stringify(account.email)} is invalid`,
        account.passwordLength < MIN_PASSWORD_LENGTH && `password is ${account.passwordLength} characters (min ${MIN_PASSWORD_LENGTH})`,
        !account.consent && "consent not given",
      ].filter((p): p is string => typeof p === "string");
  const sent = invites.filter((i) => i.status === "sent" && isEmail(i.email));

  const checks = [
    check(
      "account_created",
      accountProblems.length === 0,
      accountProblems.length === 0 && account ? `account for ${account.email}` : accountProblems.join("; "),
    ),
    check(
      "exactly_one_workspace",
      workspaces.length === 1,
      workspaces.length === 0
        ? "no workspace"
        : `${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"}: ${workspaces.map((w) => w.name).join(", ")}`,
    ),
    check("free_plan_selected", plan === "free", plan ? `plan is ${plan}` : "no plan selected"),
    check(
      "invite_sent",
      sent.length > 0,
      sent.length > 0
        ? `invite sent to ${sent.map((i) => i.email).join(", ")}`
        : invites.length > 0
          ? `${invites.length} invite(s), none to a valid address`
          : "no invite sent",
    ),
    check("no_paid_trial", !state.paidTrialStarted, state.paidTrialStarted ? "paid trial started (Pro was chosen)" : "no paid trial started"),
  ];

  return GoalCheckResult.parse({ runId: state.runId, achieved: checks.every((c) => c.passed), checks, at: now.toISOString() });
}

export interface CheckGoalOptions {
  // Read state over HTTP from a running prototype (e.g. "http://localhost:5173") instead of from disk.
  baseUrl?: string;
  // Runs directory for the direct read; defaults to GHOSTLOOP_RUNS_DIR or <repo>/.runs.
  dir?: string;
}

export async function checkGoal(runId: string, options: CheckGoalOptions = {}): Promise<GoalCheckResult> {
  if (!isRunId(runId)) throw new InvalidRunIdError(runId);
  const state = options.baseUrl ? await fetchState(options.baseUrl, runId) : await createRunStore(options.dir ?? defaultRunsDir()).get(runId);
  if (!state) throw new RunNotFoundError(runId);
  if (state.runId !== runId) throw new Error("Goal state belongs to another run");
  return evaluateGoal(state);
}

async function fetchState(baseUrl: string, runId: string): Promise<RunState | null> {
  const res = await fetch(new URL(`/api/runs/${runId}/state`, baseUrl), { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /api/runs/${runId}/state failed: ${res.status}`);
  return RunState.parse(await res.json());
}
