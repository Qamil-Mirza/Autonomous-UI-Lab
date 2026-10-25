import { createCommandProcessor } from "./command-processor";
import { createCommands } from "./commands";
import { ExperimentRuntime, type ControllerDeps } from "./controller";
import { createMockAdapters } from "./mocks";
import { dispatchCandidates, dispatchSimulation, type Imports } from "./imported";
import { startImportApi } from "@ghostloop/importer";
import { recoverInterruptedApprovals } from "./recovery";
import { openWriterStore } from "./spacetime-env";

export interface WorkerOptions {
  uri: string;
  database: string;
  /** Where the SpacetimeDB token lives, so the worker keeps its writer identity across restarts (spec §6). */
  tokenPath: string;
  /** Overrides for the default adapters (the demo's mocks with the improved candidate). */
  adapters?: Partial<Pick<ControllerDeps, "simulation" | "analysis" | "candidates">>;
  log?: (line: string) => void;
  /**
   * Called once if the connection to SpacetimeDB is lost (server restart, network drop); not called for `close()`.
   * The worker does not reconnect and its writes now fail: the owner should exit (a rerun resumes, spec §6).
   */
  onDisconnect?: (err: Error) => void;
  /**
   * Imported Figma Make apps: batches and candidates on imported versions go to these adapters (never to mocks),
   * and the import HTTP API is served on `importPort` (loopback). Absent: onboarding only.
   */
  imports?: Imports & { port?: number; allowedOrigins?: string[] };
}

/**
 * Starts the long-running worker: the only writer of experiment state (spec §5, §6, §8.1). Order matters: commands
 * left `running` by a dead worker are failed and half-written approvals repaired before any drive or new command
 * runs; then every started experiment not `stopped` is resumed and the command processor starts.
 */
export async function startWorker(opts: WorkerOptions) {
  const log = opts.log ?? (() => {});
  const store = await openWriterStore({
    ...opts,
    onDisconnect: (err) => {
      log(`disconnected: ${err.message}`);
      opts.onDisconnect?.(err);
    },
  });
  log(`connected to ${opts.database} at ${opts.uri} as the writer`);

  try {
    const clock = () => new Date().toISOString();
    // An explicit `undefined` in `opts.adapters` keeps the default mock.
    const adapters = Object.fromEntries(Object.entries(opts.adapters ?? {}).filter(([, v]) => v !== undefined));
    const base = {
      // Batch phase comes from the stored batch record, so a restarted mock replays the right fixture.
      ...createMockAdapters("improved", { phaseOf: async (req) => (await store.getBatch(req.batchId))?.phase }),
      ...adapters,
    };
    const imports = opts.imports;
    const runtime = new ExperimentRuntime({
      store,
      ...base,
      ...(imports
        ? {
            simulation: dispatchSimulation(imports.ownership, imports.simulation, base.simulation),
            candidates: dispatchCandidates(imports.ownership, imports.candidates, base.candidates),
          }
        : {}),
      clock,
      now: Date.now,
    });
    const commands = createCommands(store, runtime, clock);
    let importServer: Awaited<ReturnType<typeof startImportApi>> | undefined;
    if (imports) {
      imports.service.commands = commands;
      await imports.service.init();
      importServer = await startImportApi(imports.service, { port: imports.port, allowedOrigins: imports.allowedOrigins });
      const a = importServer.address();
      log(`import API on http://127.0.0.1:${a && typeof a === "object" ? a.port : imports.port}`);
    }
    const processor = createCommandProcessor(store.connection, commands, log);

    const failed = await processor.failRunning();
    if (failed > 0) log(`failed ${failed} command(s) left running by a previous worker`);
    const repaired = await recoverInterruptedApprovals(store);
    if (repaired.length > 0) log(`repaired interrupted approvals: ${repaired.join(", ")}`);
    for (const exp of await store.listExperiments()) {
      // A created experiment nobody started waits for `startExperiment`; launching it would start it.
      if (exp.state === "stopped" || (exp.state === "created" && !exp.startedAt)) continue;
      log(`resuming ${exp.id} (${exp.state})`);
      runtime.launch(exp.id);
    }
    processor.start();

    return {
      store,
      runtime,
      processor,
      /** Disconnects. Drives are not aborted: an abort would record `USER_STOP`; the next worker resumes them. */
      async close(): Promise<void> {
        // Sandbox containers first: an open HTTP keep-alive (e.g. the dashboard's polling) must not delay their removal.
        await imports?.service.shutdown();
        if (importServer) {
          const closed = new Promise<void>((resolve) => importServer!.close(() => resolve()));
          importServer.closeAllConnections();
          await closed;
        }
        await store.close();
      },
    };
  } catch (e) {
    await store.close();
    throw e;
  }
}
