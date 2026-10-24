import {
  CandidateDesign,
  DesignManifest,
  SCHEMA_VERSION,
  ValidationResult,
  newId,
  type Evaluation,
  type Experiment,
  type GuardrailResult,
  type RunMetrics,
  type StoppingReason,
} from "@ghostloop/contracts";
import { compare, stoppingReasonFor, type Comparison } from "../evaluator";
import { adapter, IntegrationError, metricsFor, parsed, stop, transition, type StepContext } from "./context";

/** `awaiting_approval`: parks until `ApprovePatches` records an approval; an empty approval ends the round. */
export async function awaitingApproval(ctx: StepContext, e: Experiment): Promise<boolean> {
  if (!e.round.approvalId) return false;
  const approval = await ctx.deps.store.getApproval(e.id, e.round.index);
  // The command claims the round first and writes the Approval right after; it relaunches the drive once written.
  if (!approval || approval.id !== e.round.approvalId) return false;
  if (approval.patchIds.length === 0) {
    await stop(ctx, "NO_VALID_PATCH", "designer approved no patches");
    return true;
  }
  await transition(ctx, "patching");
  return true;
}

/**
 * `patching`: only `approved` patches of this round's approval go to C, against the incumbent. C's answer must
 * cover exactly those patches (ruling R9) and build on the incumbent; the candidate and its immutable
 * `DesignVersion` are recorded and the patches marked `applied`.
 */
export async function patching(ctx: StepContext, e: Experiment): Promise<boolean> {
  const { store, candidates } = ctx.deps;
  if (e.round.candidateId) {
    await transition(ctx, "validating"); // resumed after the candidate was recorded
    return true;
  }
  const approval = await store.getApproval(e.id, e.round.index);
  if (!approval || approval.sourceVersionId !== e.incumbentVersionId) {
    await stop(ctx, "NO_VALID_PATCH", `approval is for ${approval?.sourceVersionId ?? "(none)"}, not the incumbent ${e.incumbentVersionId}`);
    return true;
  }
  const approvedIds = new Set<string>(approval.patchIds);
  const patches = (await store.listPatches(e.id, e.round.index)).filter((p) => approvedIds.has(p.id) && p.state === "approved");
  if (patches.length === 0) {
    await stop(ctx, "NO_VALID_PATCH", "no approved patches to apply");
    return true;
  }
  const patchIds = patches.map((p) => p.id);
  const source = e.incumbentVersionId;
  const cand = parsed(CandidateDesign, await adapter(ctx, "createCandidate", () => candidates.createCandidate(source, patches)), "createCandidate");

  const returned = new Set<string>(cand.patchIds);
  if (returned.size !== patchIds.length || patchIds.some((id) => !returned.has(id))) {
    throw new IntegrationError(`createCandidate applied patches [${cand.patchIds.join(", ")}], approved [${patchIds.join(", ")}]`);
  }
  if (cand.parentVersionId !== source) throw new IntegrationError(`createCandidate built on ${cand.parentVersionId}, not the incumbent ${source}`);
  if (await store.getVersion(cand.versionId)) throw new IntegrationError(`createCandidate reused existing version ${cand.versionId}`);

  let manifestHash: string;
  try {
    manifestHash = parsed(DesignManifest, await adapter(ctx, "getManifest", () => candidates.getManifest(cand.versionId)), "getManifest").manifestHash;
  } catch (err) {
    if (!(err instanceof IntegrationError) || !cand.figma) throw err; // CancelledError is not an IntegrationError
    manifestHash = cand.figma.manifestHash;
  }

  const { evaluationId: _ignored, ...fromC } = cand;
  await store.putCandidate(e.id, { ...fromC, patchIds, reviewStatus: "pending" });
  await store.insertVersion({
    schemaVersion: SCHEMA_VERSION,
    id: cand.versionId,
    parentVersionId: source,
    patchIds,
    url: cand.url,
    manifestHash,
    createdAt: cand.createdAt,
  });
  for (const id of patchIds) await store.updatePatch(id, { state: "applied" });
  await transition(ctx, "validating", (x) => ({ ...x, round: { ...x.round, candidateId: cand.id } }), `candidate ${cand.id}`);
  return true;
}

const guardrailsOf = (v: ValidationResult): GuardrailResult[] =>
  v.checks
    .filter((c) => c.kind === "guardrail")
    .map((c) => ({ name: c.name, passed: c.passed, ...(c.detail !== undefined && { detail: c.detail }) }));

async function currentCandidate(ctx: StepContext, e: Experiment): Promise<CandidateDesign> {
  const cand = e.round.candidateId ? await ctx.deps.store.getCandidate(e.round.candidateId) : undefined;
  if (!cand) throw new Error(`experiment ${e.id}: no candidate for round ${e.round.index}`);
  return cand;
}

/** Writes the Evaluation, links it from the candidate, and moves to the decision state. */
async function decide(
  ctx: StepContext,
  e: Experiment,
  cand: CandidateDesign,
  baseline: RunMetrics,
  candidate: RunMetrics | null,
  guardrails: GuardrailResult[],
  cmp: Comparison,
  stoppingReason: StoppingReason | null,
): Promise<void> {
  const { store, clock } = ctx.deps;
  const evaluation: Evaluation = {
    schemaVersion: SCHEMA_VERSION,
    id: newId("eval"),
    experimentId: e.id,
    protocolId: e.protocol.id,
    baselineVersionId: e.incumbentVersionId,
    candidateVersionId: cand.versionId,
    baseline,
    candidate,
    guardrails,
    deltaPp: cmp.deltaPp,
    decision: cmp.decision,
    reasons: cmp.reasons,
    ...(stoppingReason !== null && { stoppingReason }),
    at: clock(),
  };
  await store.putEvaluation(evaluation);
  await store.putCandidate(e.id, { ...cand, evaluationId: evaluation.id });
  await transition(ctx, cmp.decision, (x) => ({ ...x, round: { ...x.round, evaluationId: evaluation.id } }), cmp.reasons.join("; "));
}

/**
 * `validating`: a failed runnable check (or `ok: false` with nothing failing) → INTEGRATION_FAILURE, no Evaluation.
 * A failed guardrail → rejected Evaluation without candidate metrics, then NO_VALID_PATCH. Neither retests.
 */
export async function validating(ctx: StepContext, e: Experiment): Promise<boolean> {
  const cand = await currentCandidate(ctx, e);
  const v = parsed(ValidationResult, await adapter(ctx, "validateCandidate", () => ctx.deps.candidates.validateCandidate(cand.id)), "validateCandidate");
  if (v.candidateId !== cand.id) throw new IntegrationError(`validateCandidate answered for ${v.candidateId}, not ${cand.id}`);
  await ctx.deps.store.putValidation(v);

  const runnableFailed = v.checks.filter((c) => c.kind === "runnable" && !c.passed);
  if (runnableFailed.length > 0 || (!v.ok && v.checks.every((c) => c.passed))) {
    const names = runnableFailed.map((c) => c.name).join(", ") || "validation not ok";
    await stop(ctx, "INTEGRATION_FAILURE", `candidate failed runnable checks: ${names}`);
    return true;
  }
  const guardrails = guardrailsOf(v);
  if (guardrails.some((g) => !g.passed)) {
    const baseline = await metricsFor(ctx, e, e.round.baselineBatchId);
    await decide(ctx, e, cand, baseline, null, guardrails, compare(baseline, null, guardrails, e.protocol.policy), "NO_VALID_PATCH");
    return true;
  }
  await transition(ctx, "candidate_running");
  return true;
}

/** `comparing`: independent baseline vs fresh-retest comparison, decided in code. */
export async function comparing(ctx: StepContext, e: Experiment): Promise<boolean> {
  const cand = await currentCandidate(ctx, e);
  const validation = await ctx.deps.store.getValidation(cand.id);
  if (!validation) throw new Error(`experiment ${e.id}: no validation recorded for ${cand.id}`);
  const guardrails = guardrailsOf(validation);
  const { policy, budgets } = e.protocol;
  const baseline = await metricsFor(ctx, e, e.round.baselineBatchId);
  const candidate = await metricsFor(ctx, e, e.round.candidateBatchId);
  const cmp = compare(baseline, candidate, guardrails, policy);
  const reason = stoppingReasonFor(cmp.decision, candidate.completionRate, policy, e.round.index, budgets.maxIterations);
  await decide(ctx, e, cand, baseline, candidate, guardrails, cmp, reason);
  return true;
}

/**
 * `accepted` / `rejected` / `inconclusive`: stop with the Evaluation's stopping reason; with none (accepted, below
 * target, rounds remaining) the round parks here until a cancel writes USER_STOP.
 */
export async function decided(ctx: StepContext, e: Experiment): Promise<boolean> {
  const evaluation = e.round.evaluationId ? await ctx.deps.store.getEvaluation(e.round.evaluationId) : undefined;
  if (!evaluation) throw new Error(`experiment ${e.id}: decision state ${e.state} without an evaluation`);
  if (!evaluation.stoppingReason) return false;
  await stop(ctx, evaluation.stoppingReason);
  return true;
}
