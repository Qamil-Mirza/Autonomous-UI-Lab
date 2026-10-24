import { pathToFileURL } from "node:url";
import { DesignManifest, ExperimentProtocol, type Experiment, type Hypothesis, type RunMetrics } from "@ghostloop/contracts";
import { loadFixture } from "@ghostloop/contracts/fixtures";
import { createCommands } from "../commands";
import { ExperimentRuntime } from "../controller";
import { DEFAULT_TOKEN_PATH, openWriterStore, resolveTarget } from "../spacetime-env";
import { createMockAdapters, MOCK_CANDIDATES, type MockCandidateName } from "../mocks";
import { InMemoryStore, type ExperimentStore } from "../store";
import { recoverInterruptedApprovals } from "../recovery";


export interface DemoSummary {
  state: string;
  decision?: string;
  stoppingReason?: string;
}

const rate = (m: RunMetrics) => (m.completionRate === null ? "n/a" : `${(m.completionRate * 100).toFixed(1)}%`);
const metricsLine = (label: string, m: RunMetrics) =>
  `  ${label}: ${m.successes}/${m.validRuns} valid runs succeeded (rate ${rate(m)}), planned ${m.plannedRuns}; ` +
  `infra errors ${m.infraErrors}, cancelled ${m.cancelled} (excluded from rate)`;

function parseCandidate(argv: string[]): MockCandidateName {
  const i = argv.indexOf("--candidate");
  const v = i < 0 ? "improved" : argv[i + 1];
  if (v === undefined || !(v in MOCK_CANDIDATES)) throw new Error(`--candidate must be one of: ${Object.keys(MOCK_CANDIDATES).join(", ")}`);
  return v as MockCandidateName;
}

function parseStore(argv: string[]): "memory" | "spacetime" {
  const i = argv.indexOf("--store");
  const v = i < 0 ? "memory" : argv[i + 1];
  if (v !== "memory" && v !== "spacetime") throw new Error("--store must be one of: memory, spacetime");
  return v;
}

export interface DemoOptions {
  /** Where `--store spacetime` keeps the writer token; defaults to the worker's `<repo>/.ghostloop/worker-token`. */
  tokenPath?: string;
}

export async function main(argv: string[], log: (line: string) => void = console.log, opts: DemoOptions = {}): Promise<DemoSummary> {
  const candidate = parseCandidate(argv);
  const which = parseStore(argv);
  const NOW = () => new Date().toISOString();
  // A lost connection logs `disconnected: <reason>` and rejects the run (no reconnect); the CLI then exits 1.
  let onLost!: (err: Error) => void;
  const lost = new Promise<never>((_, reject) => {
    onLost = (err) => {
      log(`disconnected: ${err.message}`);
      reject(new Error(`DISCONNECTED: ${err.message}`));
    };
  });
  lost.catch(() => {});
  const spacetime =
    which === "spacetime"
      ? await openWriterStore({ ...resolveTarget(), tokenPath: opts.tokenPath ?? DEFAULT_TOKEN_PATH, onDisconnect: onLost })
      : undefined;
  try {
    return await Promise.race([drive(spacetime ?? new InMemoryStore(), candidate, NOW, log, spacetime !== undefined), lost]);
  } finally {
    await spacetime?.close();
  }
}

async function drive(store: ExperimentStore, candidate: MockCandidateName, NOW: () => string, log: (line: string) => void, recover: boolean): Promise<DemoSummary> {
  // The store has no reader for hypotheses, so keep what the controller writes.
  const seenHypotheses: Hypothesis[] = [];
  const putHypotheses = store.putHypotheses.bind(store);
  store.putHypotheses = async (h) => {
    seenHypotheses.push(...h);
    return putHypotheses(h);
  };
  if (recover) await recoverInterruptedApprovals(store);
  const runtime = new ExperimentRuntime({
    store,
    ...createMockAdapters(candidate),
    clock: NOW,
    now: Date.now,
  });
  const cmd = createCommands(store, runtime, NOW);

  log("MOCK MODE — synthetic fixtures, not real evidence");
  log(`candidate fixture: ${candidate}`);

  const fixture = loadFixture("protocol.default.json", ExperimentProtocol);
  const { id: _id, frozenAt: _f, experimentId: _e, ...protocol } = fixture;
  const manifest = loadFixture("manifest.base.json", DesignManifest);
  const created = await cmd.createExperiment({ protocol, baseVersionUrl: "http://localhost:5173/v/ver_base0001", baseManifestHash: manifest.manifestHash });
  if (!created.ok) throw new Error(`create failed: ${created.message}`);
  const id = created.value.experimentId;
  const base = manifest.versionId;

  let last = "";
  store.onChange((table) => {
    if (table !== "experiments") return;
    void store.getExperiment(id).then((e) => {
      if (e && e.state !== last) log(`[state] ${last || "(new)"} -> ${(last = e.state)}`);
    });
  });

  const started = await cmd.startExperiment({ experimentId: id });
  if (!started.ok) throw new Error(`start failed: ${started.message}`);
  await runtime.idle(id);
  let exp = (await store.getExperiment(id))!;
  expectState(exp, "awaiting_approval");

  log("\nObservations");
  for (const o of await store.listObservations(id)) log(`  - ${o.statement} (${o.numerator}/${o.denominator})`);
  log("Hypotheses (model-labeled, unproven)");
  for (const h of seenHypotheses) log(`  - [${h.label}] ${h.statement}`);
  const patches = await store.listPatches(id, 1);
  log("Patches");
  for (const p of patches) log(`  - ${p.id} ${p.op} ${p.targetElementId} = ${JSON.stringify(p.value)} risk=${p.risk} state=${p.state}${p.blockReason ? ` (${p.blockReason})` : ""}`);

  const pick = patches.find((p) => p.state !== "blocked");
  if (!pick) throw new Error("no non-blocked patch to approve");
  log(`\nAuto-approving ${pick.id}`);
  const approved = await cmd.approvePatches({ experimentId: id, sourceVersionId: base, round: 1, patchIds: [pick.id], approvedBy: "demo-cli" });
  if (!approved.ok) throw new Error(`approval failed: ${approved.message}`);
  await runtime.idle(id);
  exp = (await store.getExperiment(id))!;

  const evaluation = exp.round.evaluationId ? await store.getEvaluation(exp.round.evaluationId) : undefined;
  if (!evaluation) throw new Error(`no evaluation recorded; experiment is ${exp.state}${exp.stopping ? ` (${exp.stopping.reason})` : ""}`);
  log("\nMetrics");
  log(metricsLine("baseline ", evaluation.baseline));
  log(evaluation.candidate ? metricsLine("candidate", evaluation.candidate) : "  candidate: n/a");
  log(`  delta: ${evaluation.deltaPp === null ? "n/a" : `${evaluation.deltaPp} pp`}`);
  log(`Decision: ${evaluation.decision}`);
  for (const r of evaluation.reasons) log(`  reason: ${r}`);

  if (!exp.stopping) {
    // Accepted below target parks; cancel so the demo shows a stopping record.
    expectState(exp, "accepted");
    const cancelled = await cmd.cancelExperiment({ experimentId: id });
    if (!cancelled.ok) throw new Error(`cancel failed: ${cancelled.message}`);
    await runtime.idle(id);
    exp = (await store.getExperiment(id))!;
  }
  if (exp.state !== "stopped" || !exp.stopping) throw new Error(`expected stopped with a stopping record, got ${exp.state}`);
  log(`Stopping reason: ${exp.stopping.reason} (best version ${exp.stopping.bestVersionId})`);
  await new Promise((r) => setTimeout(r, 0)); // let the last [state] lines flush
  return { state: exp.state, decision: evaluation.decision, stoppingReason: exp.stopping.reason };
}

function expectState(e: Experiment, want: string): void {
  if (e.state !== want) throw new Error(`expected state ${want}, got ${e.state}${e.stopping ? ` (stopping: ${e.stopping.reason})` : ""}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(`demo failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
