import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, appendFile, rm, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page } from 'playwright';
import { AgentRunResult, AgentActionEvent, PublicAgentInput, Scenario, VersionId, ExperimentId, ProtocolId, BatchId, isBehaviorallyValid, type RunOutcome, type ControlRegistryEntry, type GoalCheckResult, type JudgeRecord, type TrialJudge } from '@ghostloop/contracts';
import { buildJudgeInput, scoreTrial, vetoViolation } from './judging';
import { openBrowserSession, captureObservation, waitForObservationReady, execute, viewport, checkPracticeGoal, type BrowserSession, type BrowserObservation } from './browser';
import { waitForDiscoveryReady } from './discovery';
import { bounded, type RunUsage } from './lifecycle';
import { ActionValidationError } from './actions';
import { verifyPrototypeGoal } from './goal';
import { requestDecision } from './decision';
import { bitdeerConfig } from './bitdeer';
import type { Decider } from './bitdeer';

export interface RunOptions {
  url: string;
  outputDir: string;
  decide: Decider;
  signal: AbortSignal;
  maxActions?: number;
  maxWallClockMs?: number;
  hookTimeoutMs?: number;
  estimatedUsdPerCall?: number;
  /** Return false to stop this run when D's global budget is exhausted. */
  onUsage?: (usage: RunUsage) => boolean | void | Promise<boolean | void>;
  task?: string;
  scenario?: Scenario;
  experimentId?: string;
  protocolId?: string;
  batchId?: string;
  headed?: boolean;
  provenance: 'live-bitdeer' | 'mock-decisions';
  deviceScaleFactor?: number;
  onEvent?: (event: AgentActionEvent) => void | Promise<void>;
  onResult?: (result: AgentRunResult) => void | Promise<void>;
  /** Upload/store an existing local screenshot and return a durable replay reference. */
  publishScreenshot?: (local: AgentRunResult['screenshots'][number]) => Promise<AgentRunResult['screenshots'][number]>;
  /** The app under test: C's onboarding prototype (`prototypeIntegration`) or an imported app. */
  prototype?: AppIntegration;
  checkGoal?: (page: Page) => Promise<boolean>;
  /**
   * Prototype runs only. The trial runs until the user stops or runs out of actions; protected rules are checked
   * after every action; at the end the judge scores the final state against the task as written.
   */
  judging?: {
    judge: TrialJudge;
    vetoRules: readonly string[];
    /** Cancels an in-flight judgment; defaults to `signal`. Batches pass their external cancel, not their deadline. */
    signal?: AbortSignal;
  };
}
/**
 * How a run reaches, observes, checks and cleans up one app version. The trusted checker is supplied here, never by
 * the model: it may read server state (the prototype) or the live page (imported apps).
 */
export interface AppIntegration {
  versionId: string;
  url: (runId: string) => string;
  /** Prepares isolated state; returns the version's control registry, or undefined when controls are discovered. */
  initialize: (runId: string, signal: AbortSignal) => Promise<ControlRegistryEntry[] | undefined>;
  /** `page` is the run's live page; page-based checkers must refuse to answer without it. */
  checkGoal: (runId: string, page?: Page) => Promise<GoalCheckResult>;
  /** Check names the evidence must contain; defaults to the onboarding checks. */
  requiredChecks?: readonly string[];
  cleanup: (runId: string) => Promise<void>;
  allowRequest: (url: string, navigation: boolean, runId: string, resourceType?: string) => boolean;
  /** Discover controls from the rendered page (role + accessible name refs) instead of a test-ID registry. */
  discover?: boolean;
  /** CSS viewport for every run of this version; defaults to 1280×800. */
  viewport?: { width: number; height: number };
  /** Recorded in metadata. */
  kind?: 'onboarding-prototype' | 'imported-app';
}

/** The judge's own time limit, independent of the run's and batch's remaining budget (above the client's 120 s). */
export const JUDGE_TIMEOUT_MS = 150_000;

export async function runOne(options: RunOptions): Promise<AgentRunResult> {
  const maxActions = options.maxActions ?? (options.prototype ? 16 : 6);
  if (!Number.isInteger(maxActions) || maxActions < 1 || maxActions > 20) throw new Error('maxActions must be between 1 and 20');
  const maxWallClockMs = options.maxWallClockMs ?? 240_000;
  const hookTimeoutMs = options.hookTimeoutMs ?? 10_000;
  for (const value of [maxWallClockMs, hookTimeoutMs])
    if (!Number.isSafeInteger(value) || value < 1 || value > 3_600_000) throw new Error('Timeouts must be integers from 1 to 3600000 ms');
  if (options.estimatedUsdPerCall !== undefined && (!Number.isFinite(options.estimatedUsdPerCall) || options.estimatedUsdPerCall < 0))
    throw new Error('estimatedUsdPerCall must be finite and nonnegative');
  const runId = `run_${randomUUID()}`;
  // Project caller data through public schemas; never spread a protocol/checker into a prompt.
  const scenario = Scenario.parse(options.scenario ?? { id: 'scn_first_time', name: 'First-time visitor', runs: 1,
    description: 'First-time visitor creating a workspace.', inputs: options.prototype
      ? { fullName: 'Jaclyn Example', email: `test-${runId}@example.com`, password: 'Demo-only-Pass123!', workspaceName: 'Demo', inviteEmail: 'teammate@example.com' }
      : { workspaceName: 'Demo' } });
  const task = PublicAgentInput.shape.task.parse(options.task ?? (options.prototype
    ? 'Create an account, create exactly one workspace on the Free plan, and send a valid invitation to one teammate without starting a paid trial.'
    : 'Create a workspace named Demo.'));
  const experimentId = ExperimentId.parse(options.experimentId ?? 'exp_practice');
  const protocolId = ProtocolId.parse(options.protocolId ?? 'proto_practice');
  const batchId = BatchId.parse(options.batchId ?? 'batch_practice');
  const versionId = VersionId.parse(options.prototype?.versionId ?? 'ver_practice');
  const configuration = options.provenance === 'live-bitdeer' ? (({ apiKey, ...publicConfig }) => publicConfig)(bitdeerConfig()) : undefined;
  const dir = resolve(options.outputDir, runId);
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, 'events.jsonl'), '');
  const startedAt = new Date().toISOString();
  const events: AgentActionEvent[] = [];
  const history: NonNullable<PublicAgentInput['history']> = [];
  const replayRefs = new Map<string, AgentRunResult['screenshots'][number]>();
  let sinkError: string | undefined;
  const screenshots: AgentRunResult['screenshots'] = [];
  let outcome: RunOutcome = 'step_limit';
  let terminalScreen = 'not_loaded';
  let lastPointer: AgentRunResult['lastPointer'];
  let session: BrowserSession | undefined;
  let page: Page | undefined;
  let phase: 'browser_error' | 'model_error' = 'browser_error';
  let errorMessage: string | undefined;
  let inferenceCalls = 0;
  const url = options.prototype?.url(runId) ?? options.url;
  let registry: ControlRegistryEntry[] | undefined;
  let goalEvidence: GoalCheckResult | undefined;
  let cleanupError: string | undefined;
  let initializationAttempted = false;
  let terminalCheckError: string | undefined;
  let browserCleanupError: string | undefined;
  let usageError: string | undefined;
  let stopReason: string | undefined;
  const judging = options.prototype ? options.judging : undefined;
  const discover = options.prototype?.discover === true;
  const localShots: { path: string; screen: string }[] = [];
  const secretElements = new Set<string>();
  let violation: string | undefined;
  let judgeRecord: JudgeRecord | undefined;
  let judgeError: string | undefined;
  const startedMs = performance.now();
  const budget = new AbortController();
  const signal = AbortSignal.any([options.signal, budget.signal]);
  const deadline = setTimeout(() => { stopReason = 'wall_clock_limit'; budget.abort(new Error('Run wall-clock limit reached')); }, maxWallClockMs);
  const usage = (): RunUsage => ({ inferenceCalls, wallClockMs: Math.max(0, performance.now() - startedMs),
    inferenceUsd: options.provenance === 'mock-decisions' ? 0 : options.estimatedUsdPerCall === undefined ? null : inferenceCalls * options.estimatedUsdPerCall,
    costBasis: options.provenance === 'mock-decisions' ? 'mock' : options.estimatedUsdPerCall === undefined ? 'unknown' : 'configured-per-call-estimate' });
  const reportUsage = async (final = false) => {
    if (!options.onUsage) return;
    const proceed = await bounded(() => options.onUsage!(usage()), hookTimeoutMs, 'Usage sink', final ? undefined : signal);
    if (proceed === false && !final) { stopReason = 'global_usage_limit'; budget.abort(new Error('Global usage limit reached')); signal.throwIfAborted(); }
  };
  const checkGoal = async (currentPage: Page) => {
    if (!options.prototype) {
      const achieved = await bounded(() => (options.checkGoal ?? checkPracticeGoal)(currentPage), hookTimeoutMs, 'Goal checker');
      await appendFile(resolve(dir, 'goal-checks.jsonl'), JSON.stringify({ at: new Date().toISOString(), afterActions: events.length, achieved }) + '\n');
      return achieved;
    }
    // Clear stale evidence before checking: a failed latest check cannot reuse an earlier success.
    goalEvidence = undefined;
    try {
      goalEvidence = await verifyPrototypeGoal(() => options.prototype!.checkGoal(runId, currentPage), runId, hookTimeoutMs, options.prototype.requiredChecks);
    } catch (error) {
      await rm(resolve(dir, 'goal-check.json'), { force: true });
      await appendFile(resolve(dir, 'goal-checks.jsonl'), JSON.stringify({ at: new Date().toISOString(),
        afterActions: events.length, status: 'error', error: error instanceof Error ? error.message : 'Goal checker failed' }) + '\n');
      throw error;
    }
    await writeFile(resolve(dir, 'goal-check.json'), JSON.stringify(goalEvidence, null, 2));
    await appendFile(resolve(dir, 'goal-checks.jsonl'), JSON.stringify({ at: new Date().toISOString(), afterActions: events.length, evidence: goalEvidence }) + '\n');
    return goalEvidence.achieved;
  };

  try {
    signal.throwIfAborted();
    if (options.prototype) {
      initializationAttempted = true;
      registry = await bounded(() => options.prototype!.initialize(runId, signal), hookTimeoutMs, 'Run initialization', signal);
    }
    session = await openBrowserSession({ url, signal, headed: options.headed,
      deviceScaleFactor: options.deviceScaleFactor, viewport: options.prototype?.viewport, discovery: discover,
      allowRequest: options.prototype ? (requestUrl, navigation, resourceType) => options.prototype!.allowRequest(requestUrl, navigation, runId, resourceType) : undefined });
    page = session.page;
    const capture = async (): Promise<BrowserObservation> => {
      const observation = await captureObservation(page!, {
        screenshotPath: resolve(dir, `${String(screenshots.length).padStart(3, '0')}.png`), registry, discover,
        allowUrl: options.prototype ? currentUrl => options.prototype!.allowRequest(currentUrl, true, runId) : undefined,
      });
      const replay = options.publishScreenshot ? await bounded(() => options.publishScreenshot!(structuredClone(observation.screenshot)), hookTimeoutMs, 'Screenshot publication', signal) : observation.screenshot;
      const validated = AgentActionEvent.shape.screenshot.unwrap().parse(replay);
      if (validated.width !== observation.screenshot.width || validated.height !== observation.screenshot.height)
        throw new Error('Published screenshot dimensions differ from the captured image');
      replayRefs.set(observation.screenshot.uri, validated);
      screenshots.push(validated);
      localShots.push({ path: observation.screenshot.uri, screen: observation.screenId });
      for (const c of observation.controls) if (c.inputType === 'password') secretElements.add(c.elementId);
      terminalScreen = observation.screenId;
      return observation;
    };
    const ready = (p: Page) => discover ? waitForDiscoveryReady(p) : waitForObservationReady(p, registry);
    await ready(page);
    let observation = await capture();
    if (!judging && await bounded(() => checkGoal(page!), hookTimeoutMs, 'Goal checker', signal)) outcome = 'goal';
    for (let step = 0; step < maxActions && outcome !== 'goal'; step++) {
      signal.throwIfAborted();
      phase = 'browser_error';
      const controls = observation.controls;
      if (!controls.length) { outcome = 'flow_blocked'; break; }
      const input = PublicAgentInput.parse({ runId, task,
        scenario: { description: scenario.description, inputs: scenario.inputs },
        screenshot: observation.screenshot, controls,
        visibleUI: { screenId: observation.screenId, alerts: observation.alerts },
        history, previousActions: events.map(e => e.action), remainingActions: maxActions - step });
      await appendFile(resolve(dir, 'model-inputs.jsonl'), JSON.stringify({ step, input }) + '\n');
      phase = 'model_error';
      const allowNavigation = (destination: string) => options.prototype
        ? options.prototype.allowRequest(destination, true, runId) : destination === url;
      const action = await requestDecision({
        decide: async (...args) => {
          await reportUsage();
          signal.throwIfAborted();
          inferenceCalls++;
          try { return await bounded(() => options.decide(...args), maxWallClockMs, 'Model decision', signal); }
          finally { if (!signal.aborted) await reportUsage(); }
        },
        input, controls, signal, allowNavigation, requireReason: Boolean(judging),
        onAttempt: async attempt => { await appendFile(resolve(dir, 'decision-attempts.jsonl'),
          JSON.stringify({ step, at: new Date().toISOString(), ...attempt }) + '\n'); },
      });
      signal.throwIfAborted();
      phase = 'browser_error';
      const before = observation;
      let pointer: AgentRunResult['lastPointer'];
      let executionStatus: 'executed' | 'rejected' | 'unknown' = 'unknown';
      let actionError: unknown;
      let after: BrowserObservation | undefined;
      await appendFile(resolve(dir, 'execution.jsonl'), JSON.stringify({ step, action, status: 'started' }) + '\n');
      try {
        pointer = await execute(page, action, registry, allowNavigation, discover);
        executionStatus = 'executed';
        if (pointer) lastPointer = pointer;
        await appendFile(resolve(dir, 'execution.jsonl'), JSON.stringify({ step, action, status: 'executed', pointer }) + '\n');
        await ready(page);
        after = await capture();
      } catch (error) {
        actionError = error;
        if (error instanceof ActionValidationError) executionStatus = 'rejected';
      }
      const alerts = after?.alerts ?? [];
      const event = AgentActionEvent.parse({ runId, experimentId, protocolId, batchId, scenarioId: scenario.id,
        decisionSource: 'model', seq: events.length, at: new Date().toISOString(), versionId,
        screenBefore: before.screenId, screenAfter: after?.screenId ?? 'unknown', action,
        result: actionError ? executionStatus === 'rejected' ? 'rejected_invalid'
          : executionStatus === 'executed' ? 'observation_error' : 'execution_error'
          : alerts.some(text => text.trim()) ? 'validation_error' : 'ok',
        executionStatus, error: actionError instanceof Error ? actionError.message : actionError ? 'Action failed' : undefined,
        pointer, viewport: before.viewport, screenshotBefore: replayRefs.get(before.screenshot.uri),
        screenshot: after ? replayRefs.get(after.screenshot.uri) : undefined, validationFeedback: alerts });
      // Persist before publishing; a sink failure never erases the local replay record.
      await appendFile(resolve(dir, 'events.jsonl'), JSON.stringify(event) + '\n');
      events.push(event);
      await appendFile(resolve(dir, 'feedback.jsonl'), JSON.stringify({ seq: event.seq, alerts }) + '\n');
      history.push({ seq: event.seq, action: event.action, screenBefore: event.screenBefore,
        screenAfter: event.screenAfter, result: event.result, alerts });
      try { await bounded(() => options.onEvent?.(structuredClone(event)), hookTimeoutMs, 'Event sink', signal); }
      catch (error) { sinkError = error instanceof Error ? error.message : 'Event sink failed'; throw new Error(`Event sink failed: ${sinkError}`); }
      if (actionError) throw actionError;
      observation = after!;
      if (judging) {
        // Only protected rules end a judged trial early; the goal itself is judged once, on the final state.
        await bounded(() => checkGoal(page!), hookTimeoutMs, 'Goal checker', signal);
        violation = vetoViolation(goalEvidence, judging.vetoRules);
        if (violation) { outcome = 'flow_blocked'; break; }
      } else if (await bounded(() => checkGoal(page!), hookTimeoutMs, 'Goal checker', signal)) { outcome = 'goal'; break; }
      if (action.type === 'stop') { outcome = 'agent_stop'; break; }
    }
  } catch (error) {
    outcome = signal.aborted ? 'user_cancelled' : phase;
    errorMessage = error instanceof Error ? error.message : 'Unknown failure';
  } finally {
    // Check before deleting isolated state, including error/stop/budget exits.
    // An infrastructure fault or cancellation remains non-behavioral even if state changed.
    if (page && (options.prototype || !page.isClosed())) {
      try {
        const achieved = await checkGoal(page);
        if (judging) violation ??= vetoViolation(goalEvidence, judging.vetoRules);
        else if (!['model_error', 'browser_error', 'user_cancelled'].includes(outcome)) {
          if (achieved) outcome = 'goal';
          else if (outcome === 'goal') { outcome = 'browser_error'; errorMessage = 'Goal verification changed at termination'; }
        }
      } catch (error) {
        terminalCheckError = error instanceof Error ? error.message : 'Terminal goal check failed';
        if (!['model_error', 'browser_error', 'user_cancelled'].includes(outcome)) {
          outcome = 'browser_error'; errorMessage = terminalCheckError;
        }
      }
    }
    try { await bounded(() => session?.close(), hookTimeoutMs, 'Browser cleanup'); }
    catch (error) { browserCleanupError = error instanceof Error ? error.message : 'Browser cleanup failed'; }
    if (options.prototype && initializationAttempted) {
      try { await bounded(() => options.prototype!.cleanup(runId), hookTimeoutMs, 'Run cleanup'); }
      catch (error) { cleanupError = error instanceof Error ? error.message : 'Cleanup failed'; }
    }
  }
  clearTimeout(deadline);
  if (signal.aborted) { outcome = 'user_cancelled'; stopReason ??= 'external_cancel'; }
  let goalVerified = outcome === 'goal';
  if (judging) {
    if (!violation && ['agent_stop', 'step_limit', 'flow_blocked'].includes(outcome)) {
      const labels = new Map((registry ?? []).map(e => [e.elementId, e.label]));
      const input = buildJudgeInput({ task, scenario, events, labels, secretElements, localShots, finalScreen: terminalScreen, appState: goalEvidence });
      try {
        // A finished trial is always judged: only an external cancel stops it, not the run's or batch's budget or deadline.
        const judgeSignal = judging.signal ?? options.signal;
        const { verdict, usd } = await bounded(() => judging.judge.judge(input, judgeSignal), JUDGE_TIMEOUT_MS, 'Judge', judgeSignal);
        judgeRecord = { ...verdict, ...judging.judge.info, usd };
        await writeFile(resolve(dir, 'judge.json'), JSON.stringify({ input, verdict: judgeRecord }, null, 2));
      } catch (error) {
        if ((judging.signal ?? options.signal).aborted) { outcome = 'user_cancelled'; stopReason ??= 'external_cancel'; }
        else { judgeError = error instanceof Error ? error.message : 'Judge failed'; errorMessage = `Judge failed: ${judgeError}`; }
      }
    }
    // A violation is reported only when it is what failed the trial, not on a cancelled or crashed run.
    ({ outcome, goalVerified, protectedViolation: violation } = scoreTrial({ ended: outcome, violation, verdict: judgeRecord, judgeError }));
  }
  try { await reportUsage(true); }
  catch (error) { usageError = error instanceof Error ? error.message : 'Usage reporting failed'; }
  const result = AgentRunResult.parse({ schemaVersion: '1.0.0', runId, experimentId, protocolId,
    versionId, scenarioId: scenario.id, batchId, events,
    goalVerified, goalEvidence: judgeRecord ? JSON.stringify(judgeRecord) : goalEvidence ? JSON.stringify(goalEvidence) : outcome === 'goal' ? 'Trusted application-state checker verified the task.' : undefined,
    ...(judgeRecord ? { judge: judgeRecord } : {}), ...(violation ? { protectedViolation: violation } : {}),
    stepCount: events.filter(e => e.action.type !== 'stop' && e.executionStatus === 'executed').length, outcome, terminalScreen, lastPointer, screenshots,
    behaviorallyValid: isBehaviorallyValid(outcome), startedAt, endedAt: new Date().toISOString() });
  await writeFile(resolve(dir, 'run.json.tmp'), JSON.stringify(result, null, 2));
  await rename(resolve(dir, 'run.json.tmp'), resolve(dir, 'run.json'));
  try { await bounded(() => options.onResult?.(structuredClone(result)), hookTimeoutMs, 'Result sink'); }
  catch (error) { sinkError = error instanceof Error ? error.message : 'Result sink failed'; }
  await writeFile(resolve(dir, 'metadata.json'), JSON.stringify({ provenance: options.provenance, model: options.provenance === 'live-bitdeer' ? process.env.BITDEER_MODEL || 'Qwen/Qwen3.8-27B' : null,
    configuration,
    usage: usage(), usageError, stopReason, browserCleanupError, decisionCalls: inferenceCalls, error: errorMessage, sinkError, terminalCheckError, cleanupError, coordinateSpace: 'css-pixels', viewport: options.prototype?.viewport ?? viewport, screenshotScale: 'css',
    integration: options.prototype?.kind ?? (options.prototype ? 'onboarding-prototype' : 'practice'),
    note: options.prototype?.kind === 'imported-app' ? 'Imported app session; controls discovered from the rendered page; success decided only by the frozen page checks (UI evidence, not backend proof).'
      : options.prototype ? 'Prototype session; trusted checker supplied by C. Batch summaries, when applicable, are in the parent directory.' : 'Practice task only; not full onboarding or a batch adapter.' }, null, 2));
  console.log(`${outcome}: ${result.stepCount} actions. Trace: ${resolve(dir, 'run.json')}`);
  if (errorMessage) console.error(errorMessage);
  return result;
}

/** Backward-compatible entry point for the existing practice CLI and callers. */
export const runPractice = runOne;
