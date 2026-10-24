import {
  BatchResult,
  newId,
  type AgentActionEvent,
  type AgentRunResult,
  type BatchRequest,
  type SimulationAdapter,
} from "@ghostloop/contracts";
import { loadFixture } from "@ghostloop/contracts/fixtures";

export interface MockSimulationPlan {
  /** Batch fixture replayed for the baseline (the first version the mock is asked to run). */
  baseline: string;
  /** Batch fixture replayed for every other version (candidates). */
  candidate: string;
  /** Delay before each run; abortable. */
  delayMs?: number;
  throwOn?: "baseline" | "candidate";
  /** Decides the phase of a request; when absent or undefined, the first version seen is the baseline. */
  phaseOf?: (req: BatchRequest) => Promise<"baseline" | "candidate" | undefined>;
}

export type MockSimulation = SimulationAdapter & { calls: BatchRequest[]; duplicatesEmitted: number };

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * MOCK B: replays a synthetic batch fixture under the request's batch/version IDs with fresh run IDs.
 * Streams every event through `onEvent` and deliberately emits one duplicate so dedupe is exercised.
 * On abort it resolves with the runs finished so far and `cancelled: true`.
 */
export function createMockSimulation(plan: MockSimulationPlan): MockSimulation {
  let baselineVersion: string | undefined;
  const mock: MockSimulation = {
    calls: [],
    duplicatesEmitted: 0,
    async runBatch(req, onEvent, signal) {
      mock.calls.push(structuredClone(req));
      baselineVersion ??= req.versionId;
      const phase = (await plan.phaseOf?.(req)) ?? (req.versionId === baselineVersion ? "baseline" : "candidate");
      if (plan.throwOn === phase) throw new Error(`mock simulation failure (${phase})`);
      const fixture = loadFixture(phase === "baseline" ? plan.baseline : plan.candidate, BatchResult);

      const runs: AgentRunResult[] = [];
      for (const src of fixture.runs) {
        if (plan.delayMs) await sleep(plan.delayMs, signal);
        if (signal.aborted) break;
        const runId = newId("run");
        const events: AgentActionEvent[] = src.events.map((e) => ({ ...e, runId, versionId: req.versionId }));
        for (const e of events) onEvent(structuredClone(e));
        if (runs.length === 0 && events.length > 0) {
          onEvent(structuredClone(events[0]!)); // deliberate duplicate
          mock.duplicatesEmitted += 1;
        }
        runs.push({ ...src, runId, experimentId: req.experimentId, batchId: req.batchId, versionId: req.versionId, protocolId: req.protocolId, events });
      }
      return {
        schemaVersion: fixture.schemaVersion,
        batchId: req.batchId,
        versionId: req.versionId,
        runs,
        usage: signal.aborted ? { ...fixture.usage, inferenceUsd: 0, inferenceCalls: 0 } : fixture.usage,
        cancelled: signal.aborted,
        plannedRuns: req.runsPerBatch,
      };
    },
  };
  return mock;
}
