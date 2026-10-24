import { z } from "zod";

const Timestamp = z.string().datetime();

export const PlanChoice = z.enum(["free", "pro"]);
export type PlanChoice = z.infer<typeof PlanChoice>;

export const Account = z.object({
  name: z.string(),
  email: z.string(),
  consent: z.boolean(),
  // The password itself is never stored; its length lets the goal checker verify the signup rule.
  passwordLength: z.number().int().nonnegative(),
});
export type Account = z.infer<typeof Account>;

export const Workspace = z.object({
  id: z.string().min(1),
  name: z.string(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Workspace = z.infer<typeof Workspace>;

export const Invite = z.object({
  email: z.string(),
  status: z.literal("sent"),
  at: Timestamp,
});
export type Invite = z.infer<typeof Invite>;

// Everything the simulated app has persisted for one run. This, not the UI, is what checkGoal trusts.
export const RunState = z.object({
  runId: z.string().min(1),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  account: Account.nullable(),
  workspaces: z.array(Workspace),
  plan: PlanChoice.nullable(),
  // Set once Pro is chosen and never cleared, so backing out to Free still counts as having started a trial.
  paidTrialStarted: z.boolean(),
  invites: z.array(Invite),
});
export type RunState = z.infer<typeof RunState>;

export function emptyRunState(runId: string, now = new Date().toISOString()): RunState {
  return { runId, createdAt: now, updatedAt: now, account: null, workspaces: [], plan: null, paidTrialStarted: false, invites: [] };
}
