import type { AgentActionEvent, GoalCheckResult, JudgeInput, JudgeVerdict, RunOutcome, Scenario } from '@ghostloop/contracts';

const REDACTED = '[redacted]';
const NOT_JUDGED: readonly RunOutcome[] = ['model_error', 'browser_error', 'user_cancelled'];

/**
 * The evidence a judge sees for one finished trial. The scenario password never leaves the simulator; element IDs are
 * shown by their visible label when the registry has one.
 */
export function buildJudgeInput(args: {
  task: string;
  scenario: Scenario;
  events: AgentActionEvent[];
  labels: Map<string, string>;
  localShots: { path: string; screen: string }[];
  finalScreen: string;
  appState: GoalCheckResult | undefined;
}): JudgeInput {
  const secret = args.scenario.inputs.password;
  const hide = (value: string | undefined) => (value !== undefined && secret && value === secret ? REDACTED : value);
  const screens: string[] = [];
  for (const e of args.events) for (const s of [e.screenBefore, e.screenAfter]) if (!screens.includes(s)) screens.push(s);
  return {
    task: args.task,
    scenario: {
      description: args.scenario.description,
      inputs: Object.fromEntries(Object.entries(args.scenario.inputs).map(([k, v]) => [k, hide(v) ?? v])),
    },
    steps: args.events.map(e => ({
      seq: e.seq,
      action: e.action.type,
      target: e.action.type === 'stop' ? 'session' : e.action.elementId ? (args.labels.get(e.action.elementId) || e.action.elementId) : 'page',
      ...(e.action.value !== undefined ? { value: hide(e.action.value) } : {}),
      ...(e.action.reason ? { reason: e.action.reason } : {}),
      result: e.result,
      screenBefore: e.screenBefore,
      screenAfter: e.screenAfter,
    })),
    screens,
    finalScreen: args.finalScreen,
    appState: (args.appState?.checks ?? []).map(c => ({ name: c.name, passed: c.passed, ...(c.detail ? { detail: c.detail } : {}) })),
    screenshots: keyScreenshots(args.localShots),
  };
}

/** The final screenshot plus the last shot before each screen change, most recent kept, at most `max`, in trial order. */
export function keyScreenshots(shots: { path: string; screen: string }[], max = 6): { label: string; path: string }[] {
  const last = shots.at(-1);
  if (!last) return [];
  const leaving = shots.slice(0, -1).flatMap((s, i) => (shots[i + 1]!.screen !== s.screen ? [{ label: `before leaving ${s.screen}`, path: s.path }] : []));
  return [...leaving.slice(-(max - 1)), { label: `final screen (${last.screen})`, path: last.path }];
}

/** The first veto rule whose check exists in the application state and failed. */
export function vetoViolation(state: GoalCheckResult | undefined, rules: readonly string[]): string | undefined {
  return rules.find(rule => state?.checks.some(c => c.name === rule && !c.passed));
}

/**
 * Final outcome of a judged trial: infrastructure errors and cancellations stand; a broken protected rule fails it;
 * a failed judge call is a model error; only a confident "reached" is a goal; otherwise the trial keeps how it ended.
 */
export function scoreTrial(args: { ended: RunOutcome; violation?: string; verdict?: JudgeVerdict; judgeError?: string }): { outcome: RunOutcome; goalVerified: boolean } {
  if (NOT_JUDGED.includes(args.ended)) return { outcome: args.ended, goalVerified: false };
  if (args.violation) return { outcome: 'flow_blocked', goalVerified: false };
  if (args.judgeError) return { outcome: 'model_error', goalVerified: false };
  if (args.verdict?.reached === true) return { outcome: 'goal', goalVerified: true };
  return { outcome: args.ended === 'goal' ? 'agent_stop' : args.ended, goalVerified: false };
}
