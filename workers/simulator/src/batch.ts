import { mkdir, readFile, writeFile, rename, appendFile, link, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { BatchRequest, BatchResult, DEFAULT_VETO_RULES, type SimulationAdapter, type PrototypeGoalAdapter, type AgentRunResult, type TrialJudge } from '@ghostloop/contracts';
import { runOne, type AppIntegration, type RunOptions } from './run';
import { prototypeIntegration } from './prototype';
import { bitdeerDecider, type Decider } from './bitdeer';
import { ModelResponseError } from './decision';

export interface BatchOptions {
  outputDir: string;
  /** C's trusted onboarding checker; required unless `integration` supplies the app. */
  goalAdapter?: PrototypeGoalAdapter;
  /**
   * Resolves the app for a request (e.g. an imported app's preview and frozen checks). Defaults to C's onboarding
   * prototype at the request's origin.
   */
  integration?: (req: BatchRequest, signal: AbortSignal) => Promise<AppIntegration>;
  provenance: RunOptions['provenance'];
  createDecider?: () => Decider;
  headed?: boolean;
  maxWallClockMs?: number;
  maxInferenceCalls?: number;
  maxInferenceUsd?: number;
  estimatedUsdPerCall?: number;
  publishScreenshot?: RunOptions['publishScreenshot'];
  /** Scores each trial against the task as written; without it, C's fixed checker decides success. */
  judge?: TrialJudge;
}

/** Technical (model/browser) errors in a row that stop the batch; a single one is recorded and excluded instead. */
export const MAX_CONSECUTIVE_INFRA_ERRORS = 3;

/** Round-robin over scenarios, so a batch that stops early still covers every scenario. */
export function interleave<T extends { runs: number }>(scenarios: readonly T[]): T[] {
  const jobs: T[] = [];
  for (let round = 0; jobs.length < scenarios.reduce((n, s) => n + s.runs, 0); round++)
    for (const s of scenarios) if (round < s.runs) jobs.push(s);
  return jobs;
}

/** Implements D's callback interface; every slot owns a fresh browser and app run. */
export function createSimulationAdapter(options: BatchOptions): SimulationAdapter {
  return { async runBatch(raw, onEvent, externalSignal) {
    const req = BatchRequest.parse(raw);
    if (req.runsPerBatch > 100 || req.maxConcurrency > 8 || req.maxActionsPerRun > 20)
      throw new Error('Batch limits: at most 100 runs, 8 concurrent sessions, 20 actions per run');
    if (new Set(req.scenarios.map(s => s.id)).size !== req.scenarios.length ||
        req.scenarios.reduce((n, s) => n + s.runs, 0) !== req.runsPerBatch)
      throw new Error('Scenario IDs must be unique and allocations must sum to runsPerBatch');
    const base = new URL(req.versionUrl);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error('Invalid prototype URL');
    const maxMs = options.maxWallClockMs ?? 900_000;
    const maxCalls = options.maxInferenceCalls ?? req.runsPerBatch * req.maxActionsPerRun * 3;
    if (!Number.isSafeInteger(maxMs) || maxMs < 1 || maxMs > 3_600_000 || !Number.isSafeInteger(maxCalls) || maxCalls < 0)
      throw new Error('Invalid batch wall-clock or inference-call limit');
    const price = options.provenance === 'mock-decisions' ? 0 : options.estimatedUsdPerCall;
    if (price !== undefined && (!Number.isFinite(price) || price < 0)) throw new Error('Invalid estimated call cost');
    if (options.maxInferenceUsd !== undefined && (!Number.isFinite(options.maxInferenceUsd) || options.maxInferenceUsd < 0 || price === undefined))
      throw new Error('A dollar limit requires a finite configured call-cost estimate');
    if (!options.integration && !options.goalAdapter) throw new Error('A batch needs a goal adapter or an app integration');
    // Resolved once per batch, so every run of it uses the same app, checks and viewport.
    const app = options.integration ? await options.integration(req, externalSignal)
      : prototypeIntegration(base.origin, req.versionId, options.goalAdapter!);
    if (app.versionId !== req.versionId) throw new Error(`Integration is for ${app.versionId}, not ${req.versionId}`);
    if (app.requiresJudge && !options.judge) throw new Error('This batch needs a judge: its app integration reports page facts, not success');
    const root = resolve(options.outputDir);
    await mkdir(root, { recursive: true });
    // Freeze public scenario definitions, allocations and action budget across A/B versions.
    const plan = JSON.stringify({ task: req.task, scenarios: req.scenarios, maxActionsPerRun: req.maxActionsPerRun, maxConcurrency: req.maxConcurrency });
    const planFile = resolve(root, `${req.protocolId}.plan.json`);
    const pendingPlan = resolve(root, `.plan-${randomUUID()}.tmp`);
    await writeFile(pendingPlan, plan, { flag: 'wx' });
    try {
      // Publish a complete immutable file atomically, even when A/B starts concurrently.
      try { await link(pendingPlan, planFile); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (await readFile(planFile, 'utf8') !== plan) throw new Error('Frozen protocol plan changed; use the same scenarios and allocations for A/B');
      }
    } finally { await rm(pendingPlan, { force: true }); }
    const dir = resolve(root, req.batchId);
    await mkdir(dir); // Never overwrite an earlier batch's evidence.
    await writeFile(resolve(dir, 'request.json'), JSON.stringify({ ...req, planHash: createHash('sha256').update(plan).digest('hex'), provenance: options.provenance,
      integration: app.kind ?? 'onboarding-prototype', viewport: app.viewport ?? null }, null, 2));
    const started = performance.now();
    const stop = new AbortController();
    const signal = AbortSignal.any([externalSignal, stop.signal]);
    let stopReason: string | undefined;
    const cancel = (reason: string) => { stopReason ??= reason; stop.abort(new Error(reason)); };
    const deadline = setTimeout(() => cancel('batch_wall_clock_limit'), maxMs);
    const jobs = interleave(req.scenarios);
    let infraStreak = 0;
    const results = new Map<number, AgentRunResult>();
    const failures: { slot: number; error: string }[] = [];
    let next = 0, calls = 0;
    // Synchronous reservation before awaiting the provider prevents concurrent overspend.
    const reserve = () => {
      signal.throwIfAborted();
      if (calls >= maxCalls || (options.maxInferenceUsd !== undefined && (calls + 1) * price! > options.maxInferenceUsd)) {
        cancel('batch_inference_limit'); signal.throwIfAborted();
      }
      calls++;
    };
    const worker = async () => {
      while (!signal.aborted && next < jobs.length) {
        const slot = next++;
        const scenario = jobs[slot]!;
        try {
          const decide = options.createDecider?.() ?? bitdeerDecider();
          const run = await runOne({ url: base.origin, outputDir: dir, signal,
            prototype: app,
            decide: async (...args) => {
              reserve();
              try { return await decide(...args); }
              catch (error) {
                // Out of credits will not recover within this batch; stop admitting work instead of failing every run.
                if (error instanceof ModelResponseError && error.message.includes('402')) cancel('model_credits_exhausted');
                throw error;
              }
            },
            task: req.task, scenario, experimentId: req.experimentId, protocolId: req.protocolId, batchId: req.batchId,
            maxActions: req.maxActionsPerRun, maxWallClockMs: Math.max(1, Math.min(240_000, Math.ceil(maxMs - (performance.now() - started)))),
            provenance: options.provenance, headed: options.headed, estimatedUsdPerCall: price,
            publishScreenshot: options.publishScreenshot,
            ...(options.judge ? { judging: { judge: options.judge, vetoRules: req.vetoRules ?? DEFAULT_VETO_RULES, signal: externalSignal } } : {}),
            onEvent: async event => { await onEvent(event); },
            onUsage: async usage => {
              await appendFile(resolve(dir, `usage-${slot}.jsonl`), JSON.stringify(usage) + '\n');
            },
          });
          results.set(slot, run);
          if (run.outcome === 'model_error' || run.outcome === 'browser_error') {
            if (++infraStreak >= MAX_CONSECUTIVE_INFRA_ERRORS) cancel('repeated_infrastructure_errors');
          } else if (run.outcome !== 'user_cancelled') infraStreak = 0;
        } catch (error) {
          failures.push({ slot, error: error instanceof Error ? error.message : 'Run startup failed' });
          cancel('run_startup_error');
        }
      }
    };
    try { await Promise.all(Array.from({ length: Math.min(req.maxConcurrency, jobs.length) }, worker)); }
    finally { clearTimeout(deadline); }
    const runs = [...results.entries()].sort(([a], [b]) => a - b).map(([, run]) => run);
    // Judge calls are priced from their real token usage and count toward D's cost budget with the simulator's calls.
    const judged = runs.filter(r => r.judge);
    const judgeUsd = judged.reduce((sum, r) => sum + r.judge!.usd, 0);
    const result = BatchResult.parse({ schemaVersion: '1.0.0', batchId: req.batchId, versionId: req.versionId,
      runs, ...(options.judge ? { judge: options.judge.info } : {}),
      usage: { inferenceCalls: calls + judged.length, inferenceUsd: calls * (price ?? 0) + judgeUsd, costKnown: price !== undefined,
        costEstimated: options.provenance === 'live-bitdeer' && price !== undefined, wallClockMs: performance.now() - started },
      cancelled: signal.aborted, plannedRuns: jobs.length });
    await writeFile(resolve(dir, 'batch.json.tmp'), JSON.stringify(result, null, 2));
    await rename(resolve(dir, 'batch.json.tmp'), resolve(dir, 'batch.json'));
    await writeFile(resolve(dir, 'metadata.json'), JSON.stringify({ stopReason: stopReason ?? (externalSignal.aborted ? 'external_cancel' : undefined), failures, provenance: options.provenance }, null, 2));
    return result;
  } };
}
