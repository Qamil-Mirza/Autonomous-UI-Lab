import { describe, expect, it } from "vitest";
import { DesignManifest, ExperimentProtocol, ObservationTrend } from "@ghostloop/contracts";
import { loadFixture } from "@ghostloop/contracts/fixtures";
import { z } from "zod";
import { createClaudeAnalysis } from "../src/claude/analysis";
import { protectedConstraintsFor, validatePacket } from "../src/policy";

// Calls the real Claude API and spends real money (about cents). Run with `npm run test:claude`.
describe.skipIf(!process.env.ANTHROPIC_LIVE_TEST)("Claude analysis (live API)", () => {
  it("returns a proposal that passes packet validation with at least one open patch", async () => {
    const observations = loadFixture("observations.json", z.array(ObservationTrend));
    const manifest = loadFixture("manifest.legacy.json", DesignManifest);
    const protocol = loadFixture("protocol.default.json", ExperimentProtocol);
    const { raw, usage } = await createClaudeAnalysis().proposeFeedback({
      experimentId: protocol.experimentId,
      versionId: manifest.versionId,
      task: protocol.task,
      intentConstraints: [...protocol.intentConstraints],
      protectedConstraints: protectedConstraintsFor(protocol),
      observations,
      editableElements: manifest.elements.filter((el) => !el.protected),
    });
    console.log(`Claude analysis cost: $${usage.inferenceUsd.toFixed(4)} in ${usage.wallClockMs} ms`);
    const result = validatePacket(raw, {
      experimentId: protocol.experimentId,
      round: 1,
      incumbentVersionId: manifest.versionId,
      protocol,
      manifest,
      observations,
      clock: () => new Date().toISOString(),
    });
    if (!result.ok) throw new Error(`invalid packet: ${result.errors.join("; ")}\nraw: ${JSON.stringify(raw)}`);
    expect(result.patches.some((p) => p.state !== "blocked")).toBe(true);
    expect(result.hypotheses.every((h) => h.label === "hypothesis")).toBe(true);
    expect(usage.inferenceUsd).toBeGreaterThan(0);
  }, 240_000);
});
