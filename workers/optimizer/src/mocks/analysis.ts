import type { AnalysisAdapter, AnalysisInput, RawFeedbackProposal } from "@ghostloop/contracts";

export type MockAnalysis = AnalysisAdapter & { calls: AnalysisInput[] };
type Response = unknown | ((input: AnalysisInput) => unknown);

/**
 * The proposal a well-behaved model would return for the demo: it cites the plan-revisit observation and suggests
 * two edits to `plan.free.cta` plus one to the protected `plan.pro.price` (which code will block).
 */
export function defaultProposal(input: AnalysisInput): RawFeedbackProposal {
  const obs =
    input.observations.find((o) => o.kind === "screen_revisit" && o.screens.includes("plan")) ?? input.observations[0];
  if (!obs) throw new Error("mock analysis: no observations to cite");
  const cite = [obs.id];
  return {
    hypotheses: [{ statement: "The free plan's call to action may be hard to distinguish from the comparison link.", observationIds: cite, confidence: "medium" }],
    patches: [
      { targetElementId: "plan.free.cta", op: "set_label", value: "Start free", observationIds: cite, rationale: "Clearer label for the free plan action." },
      { targetElementId: "plan.free.cta", op: "set_style_token", value: "button.primary", observationIds: cite, rationale: "Give the free plan action primary emphasis." },
      { targetElementId: "plan.pro.price", op: "set_label", value: "Free forever", observationIds: cite, rationale: "Make pricing less of a deterrent." },
    ],
  };
}

/**
 * MOCK model: returns `responses[i]` on the i-th call (a function is called with the input), then falls back to
 * `defaultProposal`. Passing a single function uses it for every call. Each call reports `usd` of inference.
 */
export function createMockAnalysis(responses: unknown[] | ((input: AnalysisInput) => unknown), usd = 0.05): MockAnalysis {
  const mock: MockAnalysis = {
    calls: [],
    async proposeFeedback(input) {
      const i = mock.calls.length;
      mock.calls.push(structuredClone(input));
      let r: Response;
      if (typeof responses === "function") r = responses;
      else r = i < responses.length ? responses[i] : defaultProposal;
      const raw = typeof r === "function" ? (r as (x: AnalysisInput) => unknown)(input) : structuredClone(r);
      return { raw, usage: { inferenceCalls: 1, inferenceUsd: usd, wallClockMs: 0 } };
    },
  };
  return mock;
}
