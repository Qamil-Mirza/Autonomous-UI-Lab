import {
  ApprovePatches,
  CancelExperiment,
  CreateExperiment,
  RecordFinalReview,
  SCHEMA_VERSION,
  SetObservationDisposition,
  StartExperiment,
  newId,
  type Approval,
  type CandidateReviewStatus,
  type CommandErrorCode,
  type CommandResult,
  type Experiment,
  type ExperimentId,
  type ObservationDisposition,
  type PatchId,
} from "@ghostloop/contracts";
import type { z } from "zod";
import type { ExperimentStore } from "./store";

/** What the commands need from the process that runs the controller driver. */
export interface ExperimentRuntime {
  /** (Re)launch the driver for this experiment; it resumes from stored state. */
  launch(experimentId: string): void;
  /** Abort in-flight work (the shared AbortController) for this experiment. */
  cancel(experimentId: string): void;
}

const fail = (code: CommandErrorCode, message: string): { ok: false; code: CommandErrorCode; message: string } => ({
  ok: false,
  code,
  message,
});
const done = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });

/** zod-parses the payload first; any parse failure becomes `VALIDATION_FAILED` instead of a throw. */
function handler<S extends z.ZodTypeAny, T>(schema: S, run: (p: z.infer<S>) => Promise<CommandResult<T>>) {
  return async (payload: unknown): Promise<CommandResult<T>> => {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      return fail("VALIDATION_FAILED", parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "));
    }
    return run(parsed.data);
  };
}

/** Terminal = stopped, or a stopping record has been written. A parked `accepted` with no record is not terminal. */
function isTerminal(e: Experiment): boolean {
  return e.state === "stopped" || e.stopping !== undefined;
}

/**
 * Designer commands (spec §4.6). This is the single write path for the dashboard and dev CLI, so the approval and
 * promotion guards here are what stop unapproved mutation and stale approvals.
 */
export function createCommands(store: ExperimentStore, runtime: ExperimentRuntime, clock: () => string) {
  const createExperiment = handler(CreateExperiment, async ({ protocol: draft, baseVersionUrl, baseManifestHash }) => {
    const now = clock();
    const experimentId = newId("exp");
    if (!(await store.getVersion(draft.baseVersionId))) {
      await store.insertVersion({
        schemaVersion: SCHEMA_VERSION,
        id: draft.baseVersionId,
        parentVersionId: null,
        patchIds: [],
        url: baseVersionUrl,
        manifestHash: baseManifestHash,
        createdAt: now,
      });
    }
    const experiment: Experiment = {
      schemaVersion: SCHEMA_VERSION,
      id: experimentId,
      protocol: { ...draft, id: newId("proto"), experimentId, frozenAt: now },
      state: "created",
      incumbentVersionId: draft.baseVersionId,
      round: { index: 1, analysisAttempts: 0 },
      transitions: [],
      usage: { inferenceCalls: 0, inferenceUsd: 0, wallClockMs: 0 },
      cancelRequested: false,
    };
    await store.putExperiment(experiment);
    return done({ experimentId });
  });

  const startExperiment = handler(StartExperiment, async ({ experimentId }) => {
    const exp = await store.getExperiment(experimentId);
    if (!exp) return fail("NOT_FOUND", `experiment ${experimentId} not found`);
    if (exp.state !== "created" || exp.cancelRequested) {
      return fail("INVALID_STATE", `experiment ${experimentId} can only be started from created (state ${exp.state})`);
    }
    await store.updateExperiment(experimentId, (x) => ({ ...x, startedAt: clock() }));
    runtime.launch(experimentId);
    return done({ experimentId });
  });

  const cancelExperiment = handler(CancelExperiment, async ({ experimentId }) => {
    const exp = await store.getExperiment(experimentId);
    if (!exp) return fail("NOT_FOUND", `experiment ${experimentId} not found`);
    if (isTerminal(exp)) return fail("INVALID_STATE", `experiment ${experimentId} has already stopped`);
    await store.updateExperiment(experimentId, (x) => ({ ...x, cancelRequested: true }));
    runtime.cancel(experimentId);
    // The driver records the USER_STOP; relaunching it is how a parked experiment gets its stop written.
    runtime.launch(experimentId);
    return done({ experimentId });
  });

  const setObservationDisposition = handler(SetObservationDisposition, async ({ experimentId, observationId, disposition }) => {
    const exp = await store.getExperiment(experimentId);
    if (!exp) return fail("NOT_FOUND", `experiment ${experimentId} not found`);
    const obs = await store.getObservation(observationId);
    if (!obs || obs.experimentId !== experimentId) {
      return fail("NOT_FOUND", `observation ${observationId} not found in experiment ${experimentId}`);
    }
    await store.setDisposition(obs.fingerprint, disposition);
    await store.putObservations([{ ...obs, disposition }]);
    return done<{ observationId: string; fingerprint: string; disposition: ObservationDisposition }>({
      observationId,
      fingerprint: obs.fingerprint,
      disposition,
    });
  });

  const approvePatches = handler(ApprovePatches, async ({ experimentId, sourceVersionId, round, patchIds, approvedBy }) => {
    const exp = await store.getExperiment(experimentId);
    if (!exp) return fail("NOT_FOUND", `experiment ${experimentId} not found`);
    if (exp.state !== "awaiting_approval" || exp.cancelRequested) {
      return fail("INVALID_STATE", `experiment ${experimentId} is not awaiting approval (state ${exp.state}${exp.cancelRequested ? ", cancel requested" : ""})`);
    }
    if (sourceVersionId !== exp.incumbentVersionId) {
      return fail("STALE_SOURCE_VERSION", `source version ${sourceVersionId} is not the incumbent ${exp.incumbentVersionId}`);
    }
    if (round !== exp.round.index) {
      return fail("STALE_SOURCE_VERSION", `round ${round} is not the current round ${exp.round.index}`);
    }
    if ((await store.getApproval(experimentId, round)) || exp.round.approvalId) {
      return fail("ALREADY_APPROVED", `round ${round} of experiment ${experimentId} is already approved`);
    }
    const roundPatches = await store.listPatches(experimentId, round);
    const byId = new Map(roundPatches.map((p) => [p.id as string, p]));
    const selected = [...new Set(patchIds)];
    const unknown = selected.filter((id) => !byId.has(id));
    if (unknown.length > 0) return fail("UNKNOWN_PATCH", `patches not in round ${round}: ${unknown.join(", ")}`);
    const blocked = selected.filter((id) => byId.get(id)!.state === "blocked");
    if (blocked.length > 0) return fail("PATCH_BLOCKED", `blocked patches cannot be approved: ${blocked.join(", ")}`);

    const approval: Approval = {
      schemaVersion: SCHEMA_VERSION,
      id: newId("appr"),
      experimentId: experimentId as ExperimentId,
      round,
      sourceVersionId,
      patchIds: selected as PatchId[],
      approvedBy,
      at: clock(),
    };
    // The checks above ran on a copy read before several awaits. Re-check atomically while claiming the round, so a
    // cancel or a concurrent approval that landed meanwhile wins and this call writes nothing.
    let refused: { ok: false; code: CommandErrorCode; message: string } | undefined;
    try {
      await store.updateExperiment(experimentId, (x) => {
        if (x.round.approvalId) refused = fail("ALREADY_APPROVED", `round ${round} of experiment ${experimentId} is already approved`);
        else if (x.state !== "awaiting_approval" || x.cancelRequested || x.round.index !== round || x.incumbentVersionId !== sourceVersionId) {
          refused = fail("INVALID_STATE", `experiment ${experimentId} changed before the approval was recorded (state ${x.state}${x.cancelRequested ? ", cancel requested" : ""})`);
        }
        if (refused) throw refused;
        return { ...x, round: { ...x.round, approvalId: approval.id } };
      });
    } catch (err) {
      if (refused && err === refused) return refused;
      throw err;
    }
    await store.putApproval(approval);
    const chosen = new Set<string>(selected);
    for (const p of roundPatches) {
      if (p.state === "blocked") continue;
      await store.updatePatch(p.id, { state: chosen.has(p.id) ? "approved" : "declined" });
    }
    runtime.launch(experimentId);
    return done({ approvalId: approval.id });
  });

  const recordFinalReview = handler(RecordFinalReview, async ({ experimentId, candidateId, status }) => {
    const exp = await store.getExperiment(experimentId);
    if (!exp) return fail("NOT_FOUND", `experiment ${experimentId} not found`);
    const candidate = await store.getCandidate(candidateId);
    const owner = await store.getCandidateExperimentId(candidateId);
    if (!candidate || owner !== experimentId) return fail("NOT_FOUND", `candidate ${candidateId} not found in experiment ${experimentId}`);
    if (candidate.reviewStatus !== "pending") {
      return fail("ALREADY_APPROVED", `candidate ${candidateId} already has final review ${candidate.reviewStatus}`);
    }
    const evaluation = candidate.evaluationId ? await store.getEvaluation(candidate.evaluationId) : undefined;

    if (status === "promoted_measured") {
      if (evaluation?.decision !== "accepted") {
        return fail("INVALID_STATE", `candidate ${candidateId} has no accepted evaluation; only a measured winner can be promoted`);
      }
      if (evaluation.candidateVersionId !== candidate.versionId || evaluation.experimentId !== experimentId) {
        return fail("INVALID_STATE", `evaluation ${evaluation.id} does not measure candidate ${candidateId} in experiment ${experimentId}`);
      }
      // R8: enforces the stale-approval anti-goal: a winner measured against an older incumbent cannot overwrite a newer one.
      if (candidate.parentVersionId !== exp.incumbentVersionId) {
        return fail("STALE_SOURCE_VERSION", `candidate ${candidateId} was built on ${candidate.parentVersionId}, not the incumbent ${exp.incumbentVersionId}`);
      }
    }
    if (status === "retained_aesthetic") {
      if (!evaluation) return fail("INVALID_STATE", `candidate ${candidateId} has no evaluation; guardrails unknown`);
      if (evaluation.guardrails.some((g) => !g.passed)) {
        return fail("INVALID_STATE", `candidate ${candidateId} failed a guardrail and cannot be retained`);
      }
    }

    await store.putCandidate(experimentId, { ...candidate, reviewStatus: status });
    if (status === "promoted_measured") {
      // The only path that moves the incumbent.
      await store.updateExperiment(experimentId, (x) => ({ ...x, incumbentVersionId: candidate.versionId }));
    }
    return done<{ candidateId: string; status: Exclude<CandidateReviewStatus, "pending"> }>({ candidateId, status });
  });

  return { createExperiment, startExperiment, cancelExperiment, setObservationDisposition, approvePatches, recordFinalReview };
}

/**
 * Each handler takes `unknown` and resolves to a `CommandResult`: bad input (parse failure, unknown ids, guard
 * violations) never throws. Faults raised by the store itself are not input errors and reject the promise.
 */
export type Commands = ReturnType<typeof createCommands>;
