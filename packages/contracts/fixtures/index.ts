import { readFileSync } from "node:fs";
import { z } from "zod";
import { ExperimentProtocol } from "../src/protocol";
import { DesignManifest } from "../src/manifest";
import { AgentRunResult } from "../src/agent";
import { BatchResult } from "../src/simulation";
import { DesignFeedbackPacket, ObservationTrend } from "../src/analysis";
import { CandidateDesign, ValidationResult } from "../src/candidate";
import { Evaluation } from "../src/evaluation";
import { Approval } from "../src/experiment";

export const FIXTURE_PROVENANCE = "synthetic-fixture" as const;

/** Relative fixture path (from this directory) -> the entity schema it must parse against. */
export const FIXTURE_SCHEMAS: Record<string, z.ZodTypeAny> = {
  "protocol.default.json": ExperimentProtocol,
  "manifest.base.json": DesignManifest,
  "runs/goal.json": AgentRunResult,
  "runs/agent-stop.json": AgentRunResult,
  "runs/step-limit.json": AgentRunResult,
  "runs/flow-blocked.json": AgentRunResult,
  "runs/model-error.json": AgentRunResult,
  "runs/browser-error.json": AgentRunResult,
  "runs/cancelled.json": AgentRunResult,
  "batch.metrics-4-4-2-1.json": BatchResult,
  "batch.baseline.json": BatchResult,
  "batch.candidate-improved.json": BatchResult,
  "batch.candidate-flat.json": BatchResult,
  "batch.zero-valid.json": BatchResult,
  "batch.underfilled.json": BatchResult,
  "observations.json": z.array(ObservationTrend),
  "feedback-packet.json": DesignFeedbackPacket,
  "approval.partial.json": Approval,
  "candidate.json": CandidateDesign,
  "candidate.figma-mismatch.json": CandidateDesign,
  "validation.pass.json": ValidationResult,
  "validation.fail.json": ValidationResult,
  "evaluation.accepted.json": Evaluation,
  "evaluation.rejected.json": Evaluation,
  "evaluation.inconclusive.json": Evaluation,
};

/**
 * Reads a fixture, asserts and strips its top-level `provenance` label, then parses it with `schema`.
 * Array fixtures are stored as `{ "provenance": ..., "items": [...] }` (JSON arrays cannot carry a label);
 * when `schema` is a `z.array(...)`, the `items` value is what gets parsed.
 */
export function loadFixture<T>(relPath: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T {
  const raw: unknown = JSON.parse(readFileSync(new URL(relPath, import.meta.url), "utf8"));
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`fixture ${relPath}: expected a JSON object with a provenance label`);
  }
  const { provenance, ...rest } = raw as Record<string, unknown>;
  if (provenance !== FIXTURE_PROVENANCE) {
    throw new Error(`fixture ${relPath}: provenance must be "${FIXTURE_PROVENANCE}", got ${JSON.stringify(provenance)}`);
  }
  const body = schema instanceof z.ZodArray ? rest.items : rest;
  return schema.parse(body);
}
