import { SenderError, t, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import spacetimedb from './schema';

export { default } from './schema';

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

// `json` arguments over 256 KiB are rejected: a guard against blobs, far above any real record.
const MAX_JSON_CHARS = 262144;

const COMMAND_KINDS = [
  'createExperiment',
  'startExperiment',
  'cancelExperiment',
  'setObservationDisposition',
  'approvePatches',
  'recordFinalReview',
];

function requireWriter(ctx: Ctx): void {
  const w = ctx.db.writer.slot.find(0);
  if (!w || !w.identity.isEqual(ctx.sender)) throw new SenderError('NOT_WRITER');
}

function checkSize(...values: Array<string | null | undefined>): void {
  for (const v of values) {
    if (v != null && v.length > MAX_JSON_CHARS) throw new SenderError('TOO_LARGE');
  }
}

export const claimWriter = spacetimedb.reducer((ctx) => {
  const w = ctx.db.writer.slot.find(0);
  if (!w) {
    ctx.db.writer.insert({ slot: 0, identity: ctx.sender });
    return;
  }
  if (!w.identity.isEqual(ctx.sender)) throw new SenderError('NOT_WRITER');
});

export const devReset = spacetimedb.reducer((ctx) => {
  requireWriter(ctx);
  for (const r of [...ctx.db.experiment.iter()]) ctx.db.experiment.id.delete(r.id);
  for (const r of [...ctx.db.designVersion.iter()]) ctx.db.designVersion.id.delete(r.id);
  for (const r of [...ctx.db.batch.iter()]) ctx.db.batch.id.delete(r.id);
  for (const r of [...ctx.db.agentRun.iter()]) ctx.db.agentRun.id.delete(r.id);
  for (const r of [...ctx.db.agentAction.iter()]) ctx.db.agentAction.key.delete(r.key);
  for (const r of [...ctx.db.observation.iter()]) ctx.db.observation.id.delete(r.id);
  for (const r of [...ctx.db.disposition.iter()]) ctx.db.disposition.fingerprint.delete(r.fingerprint);
  for (const r of [...ctx.db.hypothesis.iter()]) ctx.db.hypothesis.id.delete(r.id);
  for (const r of [...ctx.db.packet.iter()]) ctx.db.packet.id.delete(r.id);
  for (const r of [...ctx.db.patch.iter()]) ctx.db.patch.id.delete(r.id);
  for (const r of [...ctx.db.approval.iter()]) ctx.db.approval.key.delete(r.key);
  for (const r of [...ctx.db.candidate.iter()]) ctx.db.candidate.id.delete(r.id);
  for (const r of [...ctx.db.validation.iter()]) ctx.db.validation.candidateId.delete(r.candidateId);
  for (const r of [...ctx.db.evaluation.iter()]) ctx.db.evaluation.id.delete(r.id);
  for (const r of [...ctx.db.command.iter()]) ctx.db.command.id.delete(r.id);
});

export const putExperiment = spacetimedb.reducer(
  {
    id: t.string(),
    state: t.string(),
    round: t.u32(),
    expectedRev: t.u64(),
    json: t.string(),
  },
  (ctx, { id, state, round, expectedRev, json }) => {
    requireWriter(ctx);
    checkSize(json);
    const cur = ctx.db.experiment.id.find(id);
    const curRev = cur ? cur.rev : 0n;
    if (curRev !== expectedRev) throw new SenderError('STALE_REV');
    const row = { id, rev: curRev + 1n, state, round, updatedAt: ctx.timestamp, json };
    if (cur) ctx.db.experiment.id.update(row);
    else ctx.db.experiment.insert(row);
  }
);

export const insertVersion = spacetimedb.reducer(
  { id: t.string(), parentId: t.option(t.string()), json: t.string() },
  (ctx, { id, parentId, json }) => {
    requireWriter(ctx);
    checkSize(json);
    if (ctx.db.designVersion.id.find(id)) throw new SenderError('ALREADY_EXISTS');
    ctx.db.designVersion.insert({ id, parentId, json });
  }
);

export const putBatch = spacetimedb.reducer(
  { id: t.string(), experimentId: t.string(), round: t.u32(), json: t.string() },
  (ctx, row) => {
    requireWriter(ctx);
    checkSize(row.json);
    if (ctx.db.batch.id.find(row.id)) ctx.db.batch.id.update(row);
    else ctx.db.batch.insert(row);
  }
);

export const putRun = spacetimedb.reducer(
  { id: t.string(), batchId: t.string(), json: t.string() },
  (ctx, row) => {
    requireWriter(ctx);
    checkSize(row.json);
    if (ctx.db.agentRun.id.find(row.id)) ctx.db.agentRun.id.update(row);
    else ctx.db.agentRun.insert(row);
  }
);

export const insertAction = spacetimedb.reducer(
  { runId: t.string(), seq: t.u32(), json: t.string() },
  (ctx, { runId, seq, json }) => {
    requireWriter(ctx);
    checkSize(json);
    const key = `${runId}:${seq}`;
    if (ctx.db.agentAction.key.find(key)) return;
    ctx.db.agentAction.insert({ key, runId, seq, json });
  }
);

export const putObservation = spacetimedb.reducer(
  { id: t.string(), experimentId: t.string(), json: t.string() },
  (ctx, row) => {
    requireWriter(ctx);
    checkSize(row.json);
    if (ctx.db.observation.id.find(row.id)) ctx.db.observation.id.update(row);
    else ctx.db.observation.insert(row);
  }
);

export const setDisposition = spacetimedb.reducer(
  { fingerprint: t.string(), disposition: t.string() },
  (ctx, row) => {
    requireWriter(ctx);
    if (ctx.db.disposition.fingerprint.find(row.fingerprint)) {
      ctx.db.disposition.fingerprint.update(row);
    } else {
      ctx.db.disposition.insert(row);
    }
  }
);

export const putHypothesis = spacetimedb.reducer(
  { id: t.string(), experimentId: t.string(), round: t.u32(), json: t.string() },
  (ctx, row) => {
    requireWriter(ctx);
    checkSize(row.json);
    if (ctx.db.hypothesis.id.find(row.id)) ctx.db.hypothesis.id.update(row);
    else ctx.db.hypothesis.insert(row);
  }
);

export const putPacket = spacetimedb.reducer(
  { id: t.string(), experimentId: t.string(), round: t.u32(), json: t.string() },
  (ctx, row) => {
    requireWriter(ctx);
    checkSize(row.json);
    if (ctx.db.packet.id.find(row.id)) ctx.db.packet.id.update(row);
    else ctx.db.packet.insert(row);
  }
);

export const putPatch = spacetimedb.reducer(
  {
    id: t.string(),
    experimentId: t.string(),
    round: t.u32(),
    state: t.string(),
    json: t.string(),
  },
  (ctx, row) => {
    requireWriter(ctx);
    checkSize(row.json);
    if (ctx.db.patch.id.find(row.id)) ctx.db.patch.id.update(row);
    else ctx.db.patch.insert(row);
  }
);

export const putApproval = spacetimedb.reducer(
  {
    experimentId: t.string(),
    round: t.u32(),
    sourceVersionId: t.string(),
    json: t.string(),
  },
  (ctx, { experimentId, round, sourceVersionId, json }) => {
    requireWriter(ctx);
    checkSize(json);
    const key = `${experimentId}:${round}`;
    if (ctx.db.approval.key.find(key)) throw new SenderError('ALREADY_EXISTS');
    const exp = ctx.db.experiment.id.find(experimentId);
    if (!exp) throw new SenderError('NOT_FOUND');
    const { incumbentVersionId } = JSON.parse(exp.json) as { incumbentVersionId?: string };
    if (incumbentVersionId !== sourceVersionId) throw new SenderError('STALE_SOURCE_VERSION');
    ctx.db.approval.insert({ key, experimentId, round, json });
  }
);

export const putCandidate = spacetimedb.reducer(
  { id: t.string(), experimentId: t.string(), json: t.string() },
  (ctx, row) => {
    requireWriter(ctx);
    checkSize(row.json);
    const cur = ctx.db.candidate.id.find(row.id);
    if (cur) {
      if (cur.experimentId !== row.experimentId) throw new SenderError('OWNER_MISMATCH');
      ctx.db.candidate.id.update(row);
    } else {
      ctx.db.candidate.insert(row);
    }
  }
);

export const putValidation = spacetimedb.reducer(
  { candidateId: t.string(), json: t.string() },
  (ctx, row) => {
    requireWriter(ctx);
    checkSize(row.json);
    if (ctx.db.validation.candidateId.find(row.candidateId)) {
      ctx.db.validation.candidateId.update(row);
    } else {
      ctx.db.validation.insert(row);
    }
  }
);

export const putEvaluation = spacetimedb.reducer(
  { id: t.string(), experimentId: t.string(), json: t.string() },
  (ctx, row) => {
    requireWriter(ctx);
    checkSize(row.json);
    if (ctx.db.evaluation.id.find(row.id)) ctx.db.evaluation.id.update(row);
    else ctx.db.evaluation.insert(row);
  }
);

// Any client may submit; only the writer may start/complete.
export const submitCommand = spacetimedb.reducer(
  { kind: t.string(), payloadJson: t.string() },
  (ctx, { kind, payloadJson }) => {
    checkSize(payloadJson);
    if (!COMMAND_KINDS.includes(kind)) throw new SenderError('UNKNOWN_COMMAND');
    ctx.db.command.insert({
      id: 0n,
      kind,
      payloadJson,
      status: 'pending',
      resultJson: undefined,
      submittedBy: ctx.sender,
      submittedAt: ctx.timestamp,
      completedAt: undefined,
    });
  }
);

export const startCommand = spacetimedb.reducer({ id: t.u64() }, (ctx, { id }) => {
  requireWriter(ctx);
  const cmd = ctx.db.command.id.find(id);
  if (!cmd || cmd.status !== 'pending') throw new SenderError('NOT_RUNNING');
  ctx.db.command.id.update({ ...cmd, status: 'running' });
});

export const completeCommand = spacetimedb.reducer(
  { id: t.u64(), ok: t.bool(), resultJson: t.string() },
  (ctx, { id, ok, resultJson }) => {
    requireWriter(ctx);
    checkSize(resultJson);
    const cmd = ctx.db.command.id.find(id);
    if (!cmd || cmd.status !== 'running') throw new SenderError('NOT_RUNNING');
    ctx.db.command.id.update({
      ...cmd,
      status: ok ? 'ok' : 'error',
      resultJson,
      completedAt: ctx.timestamp,
    });
  }
);
