import { describe, expect, it } from "vitest"
import { describeCheck, formatInputs, friendlyError, isImportedVersion, lines, parseInputs, stepOf, taskProblems } from "../src/live/imports"
import { checksOf } from "../src/live/view"
import type { StoredRun } from "../src/live/snapshot"

const run = (over: Partial<StoredRun>): StoredRun =>
  ({
    schemaVersion: "1.0.0",
    runId: "run_1",
    experimentId: "exp_1",
    protocolId: "proto_1",
    versionId: "ver_imp_aaaaaaaaaaaa",
    scenarioId: "scn_1",
    batchId: "batch_1",
    goalVerified: false,
    stepCount: 0,
    outcome: "agent_stop",
    terminalScreen: "/",
    screenshots: [],
    behaviorallyValid: true,
    startedAt: "2026-10-24T10:00:00.000Z",
    endedAt: "2026-10-24T10:01:00.000Z",
    ...over,
  }) as StoredRun

describe("import helpers", () => {
  it("maps import statuses onto the five designer-facing steps", () => {
    expect(["uploading", "validating", "installing", "building", "starting", "ready_for_review", "ready_to_test"].map((s) => stepOf(s as never))).toEqual([0, 1, 2, 2, 2, 3, 4])
    expect(stepOf("failed")).toBe(-1)
  })

  it("says exactly what each check verifies", () => {
    expect(describeCheck({ kind: "route", path: "/done", match: "exact" })).toBe("The page's URL path is exactly /done (query and hash ignored).")
    expect(describeCheck({ kind: "text", text: "Order confirmed", match: "contains" })).toMatch(/contains “Order confirmed”/)
    expect(describeCheck({ kind: "control", role: "button", name: "Track order" })).toBe("A visible button whose accessible name is “Track order” is on the page.")
  })

  it("round-trips test inputs and protected lists", () => {
    const inputs = parseInputs("name=Pat Example\nemail = pat@example.com\nnot a pair\n")
    expect(inputs).toEqual({ name: "Pat Example", email: "pat@example.com" })
    expect(parseInputs(formatInputs(inputs))).toEqual(inputs)
    expect(lines(" a \n\n b")).toEqual(["a", "b"])
  })

  it("recognizes imported versions", () => {
    expect(isImportedVersion("ver_imp_aaaaaaaaaaaa")).toBe(true)
    expect(isImportedVersion("ver_baseline")).toBe(false)
  })
})

describe("checksOf", () => {
  it("reads the page-check evidence of an imported run", () => {
    const evidence = { runId: "run_1", achieved: false, at: "x", checks: [{ name: "route is /done", passed: false, detail: "Current: /bag." }] }
    expect(checksOf(run({ goalEvidence: JSON.stringify(evidence) }))).toEqual([{ name: "route is /done", passed: false, detail: "Current: /bag." }])
  })

  it("ignores judged runs and unreadable evidence", () => {
    expect(checksOf(run({ goalEvidence: "Trusted application-state checker verified the task." }))).toBeUndefined()
    expect(checksOf(run({ goalEvidence: "{}", judge: { reached: true, explanation: "x", evidence: [], model: "m", instructionVersion: "v", usd: 0 } }))).toBeUndefined()
  })
})

describe("task form guidance", () => {
  const base = {
    task: "Find the matrix coordinates for a point.",
    startRoute: "/",
    viewport: { width: 1280, height: 800 },
    successChecks: [{ kind: "text" as const, text: "", match: "contains" as const }],
    protectedTexts: [],
    protectedBehavior: [],
    inputs: {},
    personas: [],
  }

  it("lists exactly what is missing before the task can be checked", () => {
    expect(taskProblems(base)).toEqual(["Success check needs the text to look for."])
    expect(taskProblems({ ...base, task: "short", startRoute: "checkout", successChecks: [{ kind: "text", text: "Done", match: "contains" }, { kind: "route", path: "", match: "exact" }] })).toEqual([
      "Describe the task in a sentence (at least 10 characters).",
      "The starting route must be a path like / or /checkout.",
      "Success check 2 needs a route.",
    ])
    expect(taskProblems({ ...base, successChecks: [{ kind: "control", role: "button", name: "Save" }] })).toEqual([])
  })

  it("rewrites server validation messages in plain language", () => {
    expect(friendlyError("successChecks.0.text: String must contain at least 1 character(s)")).toBe("Success check 1: can't be empty")
    expect(friendlyError("task: describe the task in a sentence or more; startRoute: the starting route is a path")).toBe(
      "Task description: describe the task in a sentence or more Starting route: the starting route is a path",
    )
  })
})
