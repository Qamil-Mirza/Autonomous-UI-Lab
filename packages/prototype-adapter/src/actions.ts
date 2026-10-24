import { randomUUID } from "node:crypto";
import type { PlanChoice, RunState } from "./state";
import type { RunStore } from "./store";
import { isEmail, isFilled, MIN_PASSWORD_LENGTH } from "./validation";

// Server-side counterparts of each screen's submit. Field rules mirror the app's client checks exactly.
export type ActionResult<F extends string> =
  | { ok: true; state: RunState }
  | { ok: false; reason: "invalid"; errors: F[] }
  | { ok: false; reason: "run_not_found" };

export type SignupField = "name" | "email" | "password" | "consent";

export interface SignupInput {
  name: string;
  email: string;
  password: string;
  consent: boolean;
}

const done = <F extends string>(state: RunState | null): ActionResult<F> =>
  state ? { ok: true, state } : { ok: false, reason: "run_not_found" };

export async function signup(store: RunStore, runId: string, input: SignupInput): Promise<ActionResult<SignupField>> {
  const errors: SignupField[] = [];
  if (!isFilled(input.name)) errors.push("name");
  if (!isEmail(input.email)) errors.push("email");
  if (input.password.length < MIN_PASSWORD_LENGTH) errors.push("password");
  if (!input.consent) errors.push("consent");
  if (errors.length > 0) return { ok: false, reason: "invalid", errors };
  const account = { name: input.name.trim(), email: input.email.trim(), consent: true, passwordLength: input.password.length };
  return done(await store.update(runId, (s) => ({ ...s, account })));
}

// Upsert: the first save creates the run's workspace and later saves rename it, so Back + resubmit never adds a second.
export async function saveWorkspace(store: RunStore, runId: string, input: { name: string }): Promise<ActionResult<"name">> {
  if (!isFilled(input.name)) return { ok: false, reason: "invalid", errors: ["name"] };
  const name = input.name.trim();
  return done(
    await store.update(runId, (s) => {
      const now = new Date().toISOString();
      const [first, ...rest] = s.workspaces;
      const workspaces = first
        ? [{ ...first, name, updatedAt: now }, ...rest]
        : [{ id: `ws_${randomUUID().replace(/-/g, "").slice(0, 12)}`, name, createdAt: now, updatedAt: now }];
      return { ...s, workspaces };
    }),
  );
}

// Choosing Pro starts the paid trial; the flag is sticky even if the plan is later changed back to Free.
export async function choosePlan(store: RunStore, runId: string, input: { plan: PlanChoice }): Promise<ActionResult<"plan">> {
  return done(
    await store.update(runId, (s) => ({ ...s, plan: input.plan, paidTrialStarted: s.paidTrialStarted || input.plan === "pro" })),
  );
}

// Simulated invite service: only a valid address is recorded as sent; an invalid one persists nothing.
export async function sendInvite(store: RunStore, runId: string, input: { email: string }): Promise<ActionResult<"email">> {
  if (!isEmail(input.email)) return { ok: false, reason: "invalid", errors: ["email"] };
  const invite = { email: input.email.trim(), status: "sent" as const, at: new Date().toISOString() };
  return done(await store.update(runId, (s) => ({ ...s, invites: [...s.invites, invite] })));
}
