import { connect, type ExperimentRow, type CommandRow } from "@ghostloop/db";
import { resolveTarget } from "../spacetime-env";

const experimentDetail = (r: ExperimentRow) => ` state=${r.state} rev=${r.rev}`;
const commandDetail = (r: CommandRow) => ` ${r.kind} ${r.status}`;

async function main(): Promise<void> {
  const { uri, database } = resolveTarget();
  const { conn } = await connect({ uri, database });
  console.log(`watching ${database} at ${uri}; Ctrl+C to stop`);

  // Every generated table handle has the same callback surface; `key` names the row, `detail` adds state.
  const watch = <R>(name: string, table: { onInsert(cb: (c: unknown, r: R) => void): void; onUpdate(cb: (c: unknown, o: R, r: R) => void): void; onDelete(cb: (c: unknown, r: R) => void): void }, key: (r: R) => string, detail: (r: R) => string = () => "") => {
    table.onInsert((_c, r) => console.log(`[${name}] insert ${key(r)}${detail(r)}`));
    table.onUpdate((_c, _o, r) => console.log(`[${name}] update ${key(r)}${detail(r)}`));
    table.onDelete((_c, r) => console.log(`[${name}] delete ${key(r)}${detail(r)}`));
  };
  const db = conn.db;
  watch("experiment", db.experiment, (r) => r.id, experimentDetail);
  watch("command", db.command, (r) => String(r.id), commandDetail);
  watch("design_version", db.designVersion, (r) => r.id);
  watch("batch", db.batch, (r) => r.id);
  watch("agent_run", db.agentRun, (r) => r.id);
  watch("agent_action", db.agentAction, (r) => r.key);
  watch("observation", db.observation, (r) => r.id);
  watch("disposition", db.disposition, (r) => r.fingerprint);
  watch("hypothesis", db.hypothesis, (r) => r.id);
  watch("packet", db.packet, (r) => r.id);
  watch("patch", db.patch, (r) => r.id);
  watch("approval", db.approval, (r) => r.key);
  watch("candidate", db.candidate, (r) => r.id);
  watch("validation", db.validation, (r) => r.candidateId);
  watch("evaluation", db.evaluation, (r) => r.id);

  process.once("SIGINT", () => {
    conn.disconnect();
    process.exit(0);
  });
}

main().catch((err: unknown) => {
  console.error(`watch failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
