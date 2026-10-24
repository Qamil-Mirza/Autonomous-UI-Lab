import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { AgentRunResult, AgentActionEvent, PublicAgentInput, isBehaviorallyValid, type RunOutcome, type ControlRegistryEntry, type GoalCheckResult } from '@ghostloop/contracts';
import { observeControls, execute, screenId, viewport, checkPracticeGoal } from './browser';
import { validateDecision } from './actions';
import type { Decider } from './bitdeer';

export interface RunOptions {
  url: string;
  outputDir: string;
  decide: Decider;
  signal: AbortSignal;
  maxActions?: number;
  headed?: boolean;
  provenance: 'live-bitdeer' | 'mock-decisions';
  deviceScaleFactor?: number;
  prototype?: {
    versionId: string;
    url: (runId: string) => string;
    initialize: (runId: string, signal: AbortSignal) => Promise<ControlRegistryEntry[]>;
    checkGoal: (runId: string) => Promise<GoalCheckResult>;
    cleanup: (runId: string) => Promise<void>;
    allowRequest: (url: string, navigation: boolean, runId: string) => boolean;
  };
  checkGoal?: (page: Page) => Promise<boolean>;
}
export async function runPractice(options: RunOptions): Promise<AgentRunResult> {
  const maxActions = options.maxActions ?? (options.prototype ? 16 : 6);
  if (!Number.isInteger(maxActions) || maxActions < 1 || maxActions > 20) throw new Error('maxActions must be between 1 and 20');
  const runId = `run_${randomUUID()}`;
  const dir = resolve(options.outputDir, runId);
  await mkdir(dir, { recursive: true });
  const startedAt = new Date().toISOString();
  const events: AgentActionEvent[] = [];
  const screenshots: AgentRunResult['screenshots'] = [];
  let outcome: RunOutcome = 'step_limit';
  let terminalScreen = 'not_loaded';
  let lastPointer: AgentRunResult['lastPointer'];
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let phase: 'browser_error' | 'model_error' = 'browser_error';
  let errorMessage: string | undefined;
  let inferenceCalls = 0;
  const versionId = options.prototype?.versionId ?? 'ver_practice';
  const url = options.prototype?.url(runId) ?? options.url;
  let registry: ControlRegistryEntry[] | undefined;
  let goalEvidence: GoalCheckResult | undefined;
  let cleanupError: string | undefined;
  let initializationAttempted = false;
  const checkGoal = async (currentPage: Page) => {
    if (!options.prototype) return (options.checkGoal ?? checkPracticeGoal)(currentPage);
    goalEvidence = await options.prototype.checkGoal(runId);
    await writeFile(resolve(dir, 'goal-check.json'), JSON.stringify(goalEvidence, null, 2));
    return goalEvidence.achieved;
  };
  const cancel = () => { void context?.close().catch(() => {}); };
  options.signal.addEventListener('abort', cancel);
  try {
    options.signal.throwIfAborted();
    if (options.prototype) {
      initializationAttempted = true;
      registry = await options.prototype.initialize(runId, options.signal);
    }
    browser = await chromium.launch({ headless: !options.headed });
    context = await browser.newContext({ viewport, deviceScaleFactor: options.deviceScaleFactor ?? 1, serviceWorkers: 'block', acceptDownloads: false });
    // Keep navigation on this version and run; block other runs and external requests.
    await context.route('**/*', route => {
      const request = route.request();
      const allowed = options.prototype ? options.prototype.allowRequest(request.url(), request.isNavigationRequest(), runId) : request.url() === url;
      return allowed ? route.continue() : route.abort();
    });
    page = await context.newPage();
    page.setDefaultTimeout(5000);
    options.signal.throwIfAborted();
    await page.goto(url);
    const capture = async () => {
      if (options.prototype && !options.prototype.allowRequest(page!.url(), true, runId)) {
        throw new Error('Prototype navigated outside the expected version/run routes');
      }
      const uri = resolve(dir, `${String(screenshots.length).padStart(3, '0')}.png`);
      await page!.screenshot({ path: uri, scale: 'css' });
      const ref = { uri, ...viewport };
      screenshots.push(ref);
      terminalScreen = await screenId(page!);
      return ref;
    };
    let screenshot = await capture();
    if (await checkGoal(page)) outcome = 'goal';
    for (let step = 0; step < maxActions && outcome !== 'goal'; step++) {
      options.signal.throwIfAborted();
      phase = 'browser_error';
      const controls = await observeControls(page, registry);
      if (!controls.length) { outcome = 'flow_blocked'; break; }
      const input = PublicAgentInput.parse({ runId, task: options.prototype ? 'Create an account, create exactly one workspace on the Free plan, and send a valid invitation to one teammate without starting a paid trial.' : 'Create a workspace named Demo.',
        scenario: { description: 'First-time visitor creating a workspace.', inputs: options.prototype ? { fullName: 'Jaclyn Example', email: `test-${runId}@example.com`, password: 'Demo-only-Pass123!', workspaceName: 'Demo', inviteEmail: 'teammate@example.com' } : { workspaceName: 'Demo' } },
        screenshot, controls, previousActions: events.map(e => e.action), remainingActions: maxActions - step });
      phase = 'model_error';
      // Fail closed: malformed output never reaches the executor. One request per step.
      inferenceCalls++;
      const action = validateDecision(await options.decide(input, controls, options.signal), controls);
      options.signal.throwIfAborted();
      phase = 'browser_error';
      const before = terminalScreen;
      const pointer = await execute(page, action, registry);
      if (pointer) lastPointer = pointer;
      screenshot = await capture();
      const event = AgentActionEvent.parse({ runId, seq: events.length, at: new Date().toISOString(), versionId,
        screenBefore: before, screenAfter: terminalScreen, action, result: 'ok', pointer, viewport, screenshot });
      const alerts = await page.locator('[role="alert"]:visible').allTextContents();
      if (alerts.some(text => text.trim())) event.result = 'validation_error';
      await appendFile(resolve(dir, 'feedback.jsonl'), JSON.stringify({ seq: event.seq, alerts }) + '\n');
      events.push(event);
      await appendFile(resolve(dir, 'events.jsonl'), JSON.stringify(event) + '\n');
      if (await checkGoal(page)) { outcome = 'goal'; break; }
      if (action.type === 'stop') { outcome = 'agent_stop'; break; }
    }
    // Check application state at termination, never model-reported success.
    if (await checkGoal(page)) outcome = 'goal';
  } catch (error) {
    outcome = options.signal.aborted ? 'user_cancelled' : phase;
    errorMessage = error instanceof Error ? error.message : 'Unknown failure';
  } finally {
    options.signal.removeEventListener('abort', cancel);
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    if (options.prototype && initializationAttempted) {
      try { await options.prototype.cleanup(runId); }
      catch (error) { cleanupError = error instanceof Error ? error.message : 'Cleanup failed'; }
    }
  }
  const result = AgentRunResult.parse({ schemaVersion: '1.0.0', runId, experimentId: 'exp_practice', protocolId: 'proto_practice',
    versionId, scenarioId: 'scn_first_time', batchId: 'batch_practice', events,
    goalVerified: outcome === 'goal', goalEvidence: goalEvidence ? JSON.stringify(goalEvidence) : outcome === 'goal' ? 'Trusted session state contains exactly one workspace named Demo.' : undefined,
    stepCount: events.filter(e => e.action.type !== 'stop').length, outcome, terminalScreen, lastPointer, screenshots,
    behaviorallyValid: isBehaviorallyValid(outcome), startedAt, endedAt: new Date().toISOString() });
  await writeFile(resolve(dir, 'run.json'), JSON.stringify(result, null, 2));
  await writeFile(resolve(dir, 'metadata.json'), JSON.stringify({ provenance: options.provenance, model: options.provenance === 'live-bitdeer' ? process.env.BITDEER_MODEL || 'Qwen/Qwen3.8-27B' : null,
    decisionCalls: inferenceCalls, error: errorMessage, cleanupError, coordinateSpace: 'css-pixels', viewport, screenshotScale: 'css', note: options.prototype ? 'Prototype integration; trusted checker supplied by C. Not a batch adapter.' : 'Practice task only; not full onboarding or a batch adapter.' }, null, 2));
  console.log(`${outcome}: ${result.stepCount} actions. Trace: ${resolve(dir, 'run.json')}`);
  if (errorMessage) console.error(errorMessage);
  return result;
}
