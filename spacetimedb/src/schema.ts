import { schema, table, t } from 'spacetimedb/server';

// Record bodies live in `json` columns (validated by the client store); only keys,
// indexes and optimistic-concurrency fields are real columns.

const writer = table(
  { name: 'writer', public: true },
  { slot: t.u8().primaryKey(), identity: t.identity() }
);

const experiment = table(
  { name: 'experiment', public: true },
  {
    id: t.string().primaryKey(),
    rev: t.u64(),
    state: t.string(),
    round: t.u32(),
    updatedAt: t.timestamp(),
    json: t.string(),
  }
);

const designVersion = table(
  { name: 'design_version', public: true },
  { id: t.string().primaryKey(), parentId: t.option(t.string()), json: t.string() }
);

const batch = table(
  { name: 'batch', public: true },
  {
    id: t.string().primaryKey(),
    experimentId: t.string().index('btree'),
    round: t.u32(),
    json: t.string(),
  }
);

const agentRun = table(
  { name: 'agent_run', public: true },
  { id: t.string().primaryKey(), batchId: t.string().index('btree'), json: t.string() }
);

const agentAction = table(
  { name: 'agent_action', public: true },
  {
    key: t.string().primaryKey(),
    runId: t.string().index('btree'),
    seq: t.u32(),
    json: t.string(),
  }
);

const observation = table(
  { name: 'observation', public: true },
  { id: t.string().primaryKey(), experimentId: t.string().index('btree'), json: t.string() }
);

const disposition = table(
  { name: 'disposition', public: true },
  { fingerprint: t.string().primaryKey(), disposition: t.string() }
);

const hypothesis = table(
  { name: 'hypothesis', public: true },
  {
    id: t.string().primaryKey(),
    experimentId: t.string().index('btree'),
    round: t.u32(),
    json: t.string(),
  }
);

const packet = table(
  { name: 'packet', public: true },
  {
    id: t.string().primaryKey(),
    experimentId: t.string().index('btree'),
    round: t.u32(),
    json: t.string(),
  }
);

const patch = table(
  { name: 'patch', public: true },
  {
    id: t.string().primaryKey(),
    experimentId: t.string().index('btree'),
    round: t.u32(),
    state: t.string(),
    json: t.string(),
  }
);

const approval = table(
  { name: 'approval', public: true },
  {
    key: t.string().primaryKey(),
    experimentId: t.string().index('btree'),
    round: t.u32(),
    json: t.string(),
  }
);

const candidate = table(
  { name: 'candidate', public: true },
  { id: t.string().primaryKey(), experimentId: t.string().index('btree'), json: t.string() }
);

const validation = table(
  { name: 'validation', public: true },
  { candidateId: t.string().primaryKey(), json: t.string() }
);

const evaluation = table(
  { name: 'evaluation', public: true },
  { id: t.string().primaryKey(), experimentId: t.string().index('btree'), json: t.string() }
);

const command = table(
  { name: 'command', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    kind: t.string(),
    payloadJson: t.string(),
    status: t.string(), // pending | running | ok | error
    resultJson: t.option(t.string()),
    submittedBy: t.identity(),
    submittedAt: t.timestamp(),
    completedAt: t.option(t.timestamp()),
  }
);

const spacetimedb = schema({
  writer,
  experiment,
  designVersion,
  batch,
  agentRun,
  agentAction,
  observation,
  disposition,
  hypothesis,
  packet,
  patch,
  approval,
  candidate,
  validation,
  evaluation,
  command,
});
export default spacetimedb;
