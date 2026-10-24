import type { AgentActionEvent, AgentRunResult, SimulationAdapter } from '@ghostloop/contracts';
import { createSimulationAdapter, type BatchOptions } from './batch';

/** Structural subset of D's ExperimentStore, including its idempotent event insertion. */
export interface ReplayStore {
  insertAction(event: AgentActionEvent): Promise<boolean>;
  putRun(run: AgentRunResult): Promise<unknown>;
}
export function createIntegratedSimulationAdapter(options: BatchOptions, store: ReplayStore): SimulationAdapter {
  const simulator = createSimulationAdapter(options);
  return { async runBatch(request, onEvent, signal) {
    const result = await simulator.runBatch(request, async event => {
      await store.insertAction(event);
      await onEvent(event);
    }, signal);
    for (const run of result.runs) await store.putRun(run);
    return result;
  } };
}
