import type { Experiment, ExperimentState, StoppingReason } from "@ghostloop/contracts";
import type { ExperimentRuntime as RuntimePort } from "./commands";
import { runBatchPhase } from "./controller/batch";
import { awaitingApproval, comparing, decided, patching, validating } from "./controller/candidate";
import { cancelPending, IntegrationError, load, stop, transition, type ControllerDeps, type StepContext } from "./controller/context";
import { diagnosing, observing, proposing } from "./controller/diagnosis";

export type { ControllerDeps } from "./controller/context";

/**
 * Resumable step machine (spec 5.6). Each `step` reads the stored experiment, does one state's work, persists the
 * results plus the transition, and returns. Per-state handlers live in `src/controller/`; each returns whether it
 * made progress (false = parked).
 */
type Handler = (ctx: StepContext, e: Experiment) => Promise<boolean>;

const HANDLERS: Record<Exclude<ExperimentState, "stopped">, Handler> = {
  created: async (ctx) => {
    await transition(ctx, "baseline_running");
    return true;
  },
  baseline_running: (ctx, e) => runBatchPhase(ctx, e, "baseline"),
  observing,
  diagnosing,
  proposing,
  awaiting_approval: awaitingApproval,
  patching,
  validating,
  candidate_running: (ctx, e) => runBatchPhase(ctx, e, "candidate"),
  comparing,
  accepted: decided,
  rejected: decided,
  inconclusive: decided,
};

const DECISION_STATES: ExperimentState[] = ["accepted", "rejected", "inconclusive"];

/** Checked before every step: cancel first, then budgets (decision states only react to a stopping reason). */
async function preCheck(ctx: StepContext, e: Experiment): Promise<StoppingReason | null> {
  if (cancelPending(ctx, e)) return "USER_STOP";
  if (DECISION_STATES.includes(e.state)) return null;
  const { budgets } = e.protocol;
  if (e.usage.inferenceUsd >= budgets.maxInferenceUsd) return "COST_BUDGET";
  if (e.startedAt && ctx.deps.now() - Date.parse(e.startedAt) >= budgets.maxWallClockMs) return "TIME_BUDGET";
  if (e.state === "patching" && !e.round.candidateId) {
    if ((await ctx.deps.store.listCandidates(e.id)).length >= budgets.maxCandidates) return "ITERATION_BUDGET";
  }
  return null;
}

async function runStep(id: string, deps: ControllerDeps, signal: AbortSignal): Promise<{ experiment: Experiment; progressed: boolean }> {
  const ctx: StepContext = { id, deps, signal };
  const e = await load(ctx);
  if (e.state === "stopped") return { experiment: e, progressed: false };
  let progressed = true;
  try {
    const reason = await preCheck(ctx, e);
    if (reason) await stop(ctx, reason);
    else progressed = await HANDLERS[e.state](ctx, e);
  } catch (err) {
    if (!(err instanceof IntegrationError)) throw err;
    const latest = await load(ctx);
    if (cancelPending(ctx, latest)) await stop(ctx, "USER_STOP");
    else await stop(ctx, "INTEGRATION_FAILURE", err.message);
  }
  return { experiment: await load(ctx), progressed };
}

/** One state's work plus its transition. */
export async function step(experimentId: string, deps: ControllerDeps, signal: AbortSignal): Promise<Experiment> {
  return (await runStep(experimentId, deps, signal)).experiment;
}

/**
 * Drives experiments in this process. `launch` coalesces: while a drive runs for an id, further launches schedule
 * exactly one more drive after it finishes (so an approval or cancel that lands mid-drive is always picked up).
 */
export class ExperimentRuntime implements RuntimePort {
  private running = new Map<string, Promise<void>>();
  private relaunch = new Set<string>();
  private controllers = new Map<string, AbortController>();
  private failures = new Map<string, unknown>();

  constructor(private readonly deps: ControllerDeps) {}

  private controller(id: string): AbortController {
    let c = this.controllers.get(id);
    if (!c) {
      c = new AbortController();
      this.controllers.set(id, c);
    }
    return c;
  }

  launch(id: string): void {
    if (this.running.has(id)) {
      this.relaunch.add(id);
      return;
    }
    const run = Promise.resolve()
      .then(async () => {
        do {
          this.relaunch.delete(id);
          await this.drive(id);
        } while (this.relaunch.has(id));
      })
      .catch((err: unknown) => {
        this.failures.set(id, err);
      })
      .finally(() => {
        this.running.delete(id);
      });
    this.running.set(id, run);
  }

  /** Aborts in-flight work for this experiment. Cancellation is final, so the controller is never reset. */
  cancel(id: string): void {
    this.controller(id).abort();
  }

  /** Steps until parked (`awaiting_approval` without approval, `accepted` without stopping reason) or stopped. */
  async drive(id: string): Promise<Experiment> {
    for (;;) {
      const { experiment, progressed } = await runStep(id, this.deps, this.controller(id).signal);
      if (!progressed) return experiment;
    }
  }

  /** Resolves when no drive is running for `id`; rejects with the error if the last drive failed unexpectedly. */
  async idle(id: string): Promise<void> {
    for (let p = this.running.get(id); p; p = this.running.get(id)) await p;
    if (this.failures.has(id)) {
      const err = this.failures.get(id);
      this.failures.delete(id);
      throw err;
    }
  }
}
