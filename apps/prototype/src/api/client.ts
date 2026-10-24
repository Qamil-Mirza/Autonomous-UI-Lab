// Every screen submit goes through the run-scoped API; the screen advances only when the server accepted it.
export type Step = "signup" | "workspace" | "plan" | "invite";

export type StepResult<F extends string> =
  | { kind: "ok" }
  // 422: the server rejected these fields; the screen shows its matching inline errors.
  | { kind: "invalid"; errors: F[] }
  // Network failure, run not initialized, or any other non-validation error.
  | { kind: "failed" };

const runUrl = (runId: string, path: string) => `/api/runs/${encodeURIComponent(runId)}/${path}`;

export async function initRun(runId: string): Promise<boolean> {
  try {
    return (await fetch(runUrl(runId, "init"), { method: "POST" })).ok;
  } catch {
    return false;
  }
}

export async function postStep<F extends string>(runId: string, step: Step, body: unknown): Promise<StepResult<F>> {
  try {
    const res = await fetch(runUrl(runId, step), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return { kind: "ok" };
    if (res.status === 422) {
      const { errors } = (await res.json()) as { errors: F[] };
      return { kind: "invalid", errors };
    }
    return { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
}
