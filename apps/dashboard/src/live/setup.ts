import { CreateExperiment, DesignManifest, ExperimentProtocolDraft } from "@ghostloop/contracts"
import defaults from "@ghostloop/contracts/fixtures/protocol.default.json"

/** What the setup form collects. */
export interface SetupForm {
  url: string
  task: string
  trials: number
  maxSteps: number
  minImprovementPp: number
  maxUsd: number
  maxMinutes: number
  manualReview: boolean
}

// The simulator's hard limits (workers/simulator/src/batch.ts).
export const LIMITS = { trials: 100, maxSteps: 20 } as const

export const DEFAULT_PROTOTYPE_URL = "http://localhost:5173/v/ver_baseline/signup"

const VERSION_IN_URL = /\/v\/(ver_[A-Za-z0-9_-]+)(?:\/|$)/

/** `http://host/v/<versionId>/...` -> the version ID and the origin its manifest is served from. */
export function parsePrototypeUrl(url: string): { versionId: string; origin: string } | { error: string } {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return { error: "Enter a full prototype URL, starting with http://" }
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { error: "The prototype URL must start with http:// or https://" }
  const m = VERSION_IN_URL.exec(u.pathname)
  if (!m) return { error: "The URL must point at a prototype version, like /v/ver_baseline/signup" }
  return { versionId: m[1]!, origin: u.origin }
}

/** Splits `total` runs across scenarios as evenly as possible, earlier scenarios taking the remainder. */
export function allocate(total: number, scenarios: number): number[] {
  const base = Math.floor(total / scenarios)
  return Array.from({ length: scenarios }, (_, i) => base + (i < total % scenarios ? 1 : 0))
}

export function validateForm(f: SetupForm): string | undefined {
  if (!f.task.trim()) return "Describe the task the simulated users should complete."
  if (!Number.isInteger(f.trials) || f.trials < 1 || f.trials > LIMITS.trials) return `Use between 1 and ${LIMITS.trials} test trials.`
  if (!Number.isInteger(f.maxSteps) || f.maxSteps < 1 || f.maxSteps > LIMITS.maxSteps)
    return `Use between 1 and ${LIMITS.maxSteps} steps per trial.`
  if (!(f.minImprovementPp >= 0)) return "The minimum improvement can't be negative."
  if (!(f.maxUsd >= 0)) return "The cost limit can't be negative."
  if (!(f.maxMinutes > 0)) return "The time limit must be more than zero minutes."
  const parsed = parsePrototypeUrl(f.url)
  return "error" in parsed ? parsed.error : undefined
}

/**
 * The `createExperiment` payload: the form's values over the default protocol (scenarios, protected
 * constraints, goal checker). Scenarios with no runs are dropped, since the protocol needs positive runs.
 */
export function buildCreatePayload(f: SetupForm, manifestHash: string): CreateExperiment {
  const parsed = parsePrototypeUrl(f.url)
  if ("error" in parsed) throw new Error(parsed.error)
  const { id: _id, frozenAt: _f, experimentId: _e, provenance: _p, ...base } = defaults as typeof defaults & { provenance?: string }
  const runs = allocate(f.trials, base.scenarios.length)
  const protocol = ExperimentProtocolDraft.parse({
    ...base,
    baseVersionId: parsed.versionId,
    task: f.task.trim(),
    mode: f.manualReview ? "manual" : "auto",
    scenarios: base.scenarios.map((s, i) => ({ ...s, runs: runs[i] })).filter((s) => s.runs > 0),
    budgets: {
      ...base.budgets,
      runsPerBatch: f.trials,
      maxActionsPerRun: f.maxSteps,
      maxConcurrency: Math.min(base.budgets.maxConcurrency, f.trials),
      maxInferenceUsd: f.maxUsd,
      maxWallClockMs: Math.round(f.maxMinutes * 60_000),
    },
    policy: { ...base.policy, minImprovementPp: f.minImprovementPp },
  })
  return CreateExperiment.parse({ protocol, baseVersionUrl: f.url, baseManifestHash: manifestHash })
}

/**
 * Reads a version's manifest. The dashboard dev server proxies `/designs` to the prototype server (which serves
 * `designs/`), so this works without CORS.
 */
export async function fetchManifest(versionId: string, fetchImpl: typeof fetch = fetch, base = "/designs"): Promise<DesignManifest> {
  const at = `${base}/versions/${versionId}.json`
  let res: Response
  try {
    res = await fetchImpl(at, { cache: "no-store" })
  } catch {
    throw new Error("Couldn't reach the prototype. Is it running (npm run dev -w @ghostloop/prototype)?")
  }
  if (res.status === 502 || res.status === 504) throw new Error("Couldn't reach the prototype. Is it running (npm run dev -w @ghostloop/prototype)?")
  if (!res.ok) throw new Error(`The prototype has no design version ${versionId} (${res.status}).`)
  return DesignManifest.parse(await res.json())
}
