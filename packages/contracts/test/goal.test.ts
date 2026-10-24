import { describe, it, expect } from "vitest";
import { GoalCheckResult } from "../src/index";

const result = {
  runId: "run_abc",
  achieved: true,
  checks: [
    { name: "account_created", passed: true, detail: "account for alex@northwind.test" },
    { name: "no_paid_trial", passed: true, detail: "no paid trial started" },
  ],
  at: "2026-10-24T12:00:00.000Z",
};

describe("GoalCheckResult", () => {
  it("accepts a consistent result", () => {
    expect(GoalCheckResult.safeParse(result).success).toBe(true);
    const failed = { ...result, achieved: false, checks: [{ ...result.checks[0]!, passed: false }] };
    expect(GoalCheckResult.safeParse(failed).success).toBe(true);
  });
  it("rejects achieved that disagrees with the checks", () => {
    expect(GoalCheckResult.safeParse({ ...result, achieved: false }).success).toBe(false);
    const oneFails = { ...result, checks: [...result.checks, { name: "invite_sent", passed: false, detail: "no invites" }] };
    expect(GoalCheckResult.safeParse(oneFails).success).toBe(false);
  });
  it("rejects a bad runId, no checks, or a non-ISO timestamp", () => {
    expect(GoalCheckResult.safeParse({ ...result, runId: "exp_abc" }).success).toBe(false);
    expect(GoalCheckResult.safeParse({ ...result, checks: [] }).success).toBe(false);
    expect(GoalCheckResult.safeParse({ ...result, at: "yesterday" }).success).toBe(false);
  });
});
