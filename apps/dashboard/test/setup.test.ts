import { describe, expect, it, vi } from "vitest"
import { allocate, buildCreatePayload, fetchManifest, parsePrototypeUrl, validateForm, type SetupForm } from "../src/live/setup"

const form = (over: Partial<SetupForm> = {}): SetupForm => ({
  url: "http://localhost:5173/v/ver_baseline/signup",
  task: "Create an account and a workspace on the Free plan.",
  trials: 10,
  maxSteps: 12,
  minImprovementPp: 15,
  maxUsd: 3,
  maxMinutes: 20,
  manualReview: true,
  ...over,
})

describe("parsePrototypeUrl", () => {
  it("extracts the version from a prototype URL", () => {
    expect(parsePrototypeUrl("http://localhost:5173/v/ver_baseline/signup")).toEqual({ versionId: "ver_baseline", origin: "http://localhost:5173" })
    expect(parsePrototypeUrl("http://localhost:5173/v/ver_c1")).toEqual({ versionId: "ver_c1", origin: "http://localhost:5173" })
  })

  it("explains what is wrong with other URLs", () => {
    expect(parsePrototypeUrl("not a url")).toHaveProperty("error")
    expect(parsePrototypeUrl("ftp://localhost/v/ver_a")).toHaveProperty("error")
    expect(parsePrototypeUrl("http://localhost:5173/signup")).toEqual({ error: "The URL must point at a prototype version, like /v/ver_baseline/signup" })
  })
})

describe("allocate", () => {
  it("splits runs evenly, remainder first, summing to the total", () => {
    expect(allocate(10, 4)).toEqual([3, 3, 2, 2])
    expect(allocate(2, 4)).toEqual([1, 1, 0, 0])
    expect(allocate(12, 4)).toEqual([3, 3, 3, 3])
  })
})

describe("validateForm", () => {
  it("accepts the default form", () => {
    expect(validateForm(form())).toBeUndefined()
  })

  it("enforces the simulator's limits", () => {
    expect(validateForm(form({ maxSteps: 21 }))).toBe("Use between 1 and 20 steps per trial.")
    expect(validateForm(form({ trials: 0 }))).toBe("Use between 1 and 100 test trials.")
    expect(validateForm(form({ trials: 101 }))).toBe("Use between 1 and 100 test trials.")
    expect(validateForm(form({ task: "  " }))).toBe("Describe the task the simulated users should complete.")
  })
})

describe("buildCreatePayload", () => {
  it("applies the form over the default protocol", () => {
    const p = buildCreatePayload(form(), "sha256:abc")
    expect(p.baseVersionUrl).toBe("http://localhost:5173/v/ver_baseline/signup")
    expect(p.baseManifestHash).toBe("sha256:abc")
    expect(p.protocol).toMatchObject({
      baseVersionId: "ver_baseline",
      task: "Create an account and a workspace on the Free plan.",
      mode: "manual",
      budgets: { runsPerBatch: 10, maxActionsPerRun: 12, maxInferenceUsd: 3, maxWallClockMs: 1_200_000 },
      policy: { minImprovementPp: 15 },
    })
    expect(p.protocol.scenarios.reduce((n, s) => n + s.runs, 0)).toBe(10)
    expect(p.protocol.protectedCategories.length).toBeGreaterThan(0)
    expect(p.protocol).not.toHaveProperty("provenance")
  })

  it("drops scenarios left without runs and caps concurrency at the trial count", () => {
    const p = buildCreatePayload(form({ trials: 2, manualReview: false }), "sha256:abc")
    expect(p.protocol.scenarios.map((s) => s.runs)).toEqual([1, 1])
    expect(p.protocol.budgets.maxConcurrency).toBe(2)
    expect(p.protocol.mode).toBe("auto")
  })
})

describe("fetchManifest", () => {
  const manifest = { schemaVersion: "1.0.0", versionId: "ver_baseline", manifestHash: "sha256:abc", elements: [] }

  it("reads the version's manifest through the /designs proxy", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(manifest), { status: 200 }))
    await expect(fetchManifest("ver_baseline", fetchImpl)).resolves.toMatchObject({ manifestHash: "sha256:abc" })
    expect(fetchImpl).toHaveBeenCalledWith("/designs/versions/ver_baseline.json", { cache: "no-store" })
  })

  it("says when the version does not exist or the prototype is down", async () => {
    await expect(fetchManifest("ver_x", async () => new Response("", { status: 404 }))).rejects.toThrow("The prototype has no design version ver_x (404).")
    await expect(fetchManifest("ver_x", async () => new Response("", { status: 502 }))).rejects.toThrow("Couldn't reach the prototype")
    await expect(fetchManifest("ver_x", async () => { throw new TypeError("fetch failed") })).rejects.toThrow("Couldn't reach the prototype")
  })
})
