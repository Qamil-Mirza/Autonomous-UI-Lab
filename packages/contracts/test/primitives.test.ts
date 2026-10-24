import { describe, it, expect } from "vitest";
import { RunId, newId, RunOutcome, BEHAVIORAL_OUTCOMES, INFRA_OUTCOMES, SCHEMA_VERSION } from "../src/index";

describe("primitives", () => {
  it("checks id prefixes", () => {
    expect(RunId.safeParse("run_abc").success).toBe(true);
    expect(RunId.safeParse("exp_abc").success).toBe(false);
    expect(RunId.safeParse(newId("run")).success).toBe(true);
  });
  it("partitions outcomes", () => {
    expect(BEHAVIORAL_OUTCOMES).toEqual(["goal", "agent_stop", "step_limit", "flow_blocked"]);
    expect(INFRA_OUTCOMES).toEqual(["model_error", "browser_error"]);
    expect(RunOutcome.options).toHaveLength(7);
    expect(SCHEMA_VERSION).toBe("1.0.0");
  });
});
