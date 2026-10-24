import { MutationOp, RiskClass, type AnalysisInput } from "@ghostloop/contracts";

export const SYSTEM_PROMPT = `You analyze recorded sessions of synthetic users attempting a task in a product design, and propose small design changes for a designer to review.

The observations you receive are neutral counts taken from those sessions. Your explanations of why something happened are hypotheses, not facts, and the proposal records them as such.

Rules for the proposal:
- Every hypothesis and every patch cites at least one observation id from the input.
- A patch targets only an element listed under editableElements and uses only one of that element's supportedOps.
- Values by op: set_label takes the new visible text; set_style_token takes a design-token name such as "button.primary"; set_order takes a zero-based position; set_visibility takes true or false.
- Never weaken a protected constraint (signup, prices, authentication, consent, validation, or the success checker), even if it would help the task.
- Prefer one to three small, targeted patches that address the most frequent observed problem.
- modelRisk is optional advice; code assigns the real risk and may block a patch.

Return only the proposal in the required format.`;

const observationView = (o: AnalysisInput["observations"][number]) => ({
  id: o.id,
  kind: o.kind,
  statement: o.statement,
  numerator: o.numerator,
  denominator: o.denominator,
  screens: o.screens,
  elementIds: o.elementIds,
  ...(o.interpretation !== undefined && { interpretation: o.interpretation }),
});

const elementView = (el: AnalysisInput["editableElements"][number]) => ({
  elementId: el.elementId,
  screen: el.screen,
  role: el.role,
  ...(el.label !== undefined && { label: el.label }),
  supportedOps: el.supportedOps,
});

/** The user turn: one JSON document with a fixed key order, so the same input always renders identically. */
export function renderAnalysisInput(input: AnalysisInput): string {
  const doc = {
    task: input.task,
    intentConstraints: input.intentConstraints,
    protectedConstraints: input.protectedConstraints,
    observations: input.observations.map(observationView),
    editableElements: input.editableElements.map(elementView),
  };
  return `Propose design feedback for this experiment.\n\n${JSON.stringify(doc, null, 2)}`;
}

const VALUE_SCHEMA: Record<MutationOp, { type: "string" | "integer" | "boolean" }> = {
  set_label: { type: "string" },
  set_style_token: { type: "string" },
  set_order: { type: "integer" },
  set_visibility: { type: "boolean" },
};

const ids = { type: "array", items: { type: "string" } } as const;

/**
 * Model-facing output schema mirroring `RawFeedbackProposal`. Structured outputs reject length and numeric
 * constraints, so those (and the ID formats) are enforced afterwards by `validatePacket`.
 */
export const PROPOSAL_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["hypotheses", "patches"],
  properties: {
    hypotheses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["statement", "observationIds"],
        properties: {
          statement: { type: "string" },
          observationIds: ids,
          confidence: { type: "string", enum: ["low", "medium", "high"] },
        },
      },
    },
    patches: {
      type: "array",
      items: {
        anyOf: MutationOp.options.map((op) => ({
          type: "object",
          additionalProperties: false,
          required: ["targetElementId", "op", "value", "observationIds", "rationale"],
          properties: {
            targetElementId: { type: "string" },
            op: { type: "string", const: op },
            value: VALUE_SCHEMA[op],
            observationIds: ids,
            rationale: { type: "string" },
            modelRisk: { type: "string", enum: [...RiskClass.options] },
          },
        })),
      },
    },
  },
} as const;
