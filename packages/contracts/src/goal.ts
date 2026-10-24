import { z } from "zod";
import { RunId } from "./ids";

// One named predicate a trusted checker evaluated against a run's application state.
export const GoalCheck = z.object({
  name: z.string().min(1),
  passed: z.boolean(),
  detail: z.string(),
});
export type GoalCheck = z.infer<typeof GoalCheck>;

// Trusted goal verdict for a run, derived from application state (never from model output or screen text).
export const GoalCheckResult = z
  .object({
    runId: RunId,
    achieved: z.boolean(),
    checks: z.array(GoalCheck).min(1),
    at: z.string().datetime(),
  })
  .superRefine((r, ctx) => {
    if (r.achieved !== r.checks.every((c) => c.passed)) {
      ctx.addIssue({ code: "custom", path: ["achieved"], message: "achieved must equal every check passing" });
    }
  });
export type GoalCheckResult = z.infer<typeof GoalCheckResult>;
