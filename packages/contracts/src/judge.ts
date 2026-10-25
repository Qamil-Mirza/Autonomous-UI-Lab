import { z } from "zod";

/** A judge's decision on one trial, from evidence of its final state. `"uncertain"` counts as not reached. */
export const JudgeVerdict = z.object({
  reached: z.union([z.boolean(), z.literal("uncertain")]),
  explanation: z.string().min(1),
  evidence: z.array(z.string()),
});
export type JudgeVerdict = z.infer<typeof JudgeVerdict>;

/** Which judge scored a batch; baseline and candidate must match for a fair comparison. */
export const JudgeInfo = z.object({ model: z.string().min(1), instructionVersion: z.string().min(1) });
export type JudgeInfo = z.infer<typeof JudgeInfo>;

/** The verdict as stored on a run, with who judged it and what the call cost. */
export const JudgeRecord = JudgeVerdict.merge(JudgeInfo).extend({ usd: z.number().nonnegative() });
export type JudgeRecord = z.infer<typeof JudgeRecord>;

/** Protected rules a simulated user can break at runtime; breaking one always fails the trial. */
export const DEFAULT_VETO_RULES = ["no_paid_trial"] as const;

export interface JudgeStep {
  seq: number;
  action: string;
  target: string;
  value?: string;
  reason?: string;
  result: string;
  screenBefore: string;
  screenAfter: string;
}

/** Everything the judge sees about one finished trial. Screenshot paths are local files. */
export interface JudgeInput {
  task: string;
  scenario: { description: string; inputs: Record<string, string> };
  steps: JudgeStep[];
  screens: string[];
  finalScreen: string;
  appState: { name: string; passed: boolean; detail?: string }[];
  screenshots: { label: string; path: string }[];
}

export interface TrialJudge {
  readonly info: JudgeInfo;
  judge(input: JudgeInput, signal: AbortSignal): Promise<{ verdict: JudgeVerdict; usd: number }>;
}
