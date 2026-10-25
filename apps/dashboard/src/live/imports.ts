import { useCallback, useEffect, useRef, useState } from "react"

/** Mirrors the worker's import API (packages/importer/src/http.ts). */
export type ImportStatus =
  | "uploading"
  | "validating"
  | "installing"
  | "building"
  | "starting"
  | "ready_for_review"
  | "ready_to_test"
  | "failed"
  | "cancelled"

export type SuccessCheck =
  | { kind: "route"; path: string; match: "exact" | "prefix" }
  | { kind: "text"; text: string; match: "contains" | "exact" }
  | { kind: "control"; role: ControlRole; name: string }

export const CONTROL_ROLES = ["button", "link", "textbox", "checkbox", "radio", "switch", "tab", "combobox", "heading"] as const
export type ControlRole = (typeof CONTROL_ROLES)[number]

export interface ImportTask {
  task: string
  startRoute: string
  viewport: { width: number; height: number }
  successChecks: SuccessCheck[]
  protectedTexts: string[]
  protectedBehavior: string[]
  inputs: Record<string, string>
  personas: { name: string; description: string }[]
}

export interface Verification {
  taskHash: string
  ok: boolean
  at: string
  screenshot?: string
  url: string
  controls: { ref: string; role: string; label: string }[]
  checks: { name: string; description: string; passedAtStart: boolean; detail: string }[]
  blockers: string[]
  warnings: string[]
}

export interface ImportView {
  id: string
  name: string
  figmaUrl?: string
  createdAt: string
  updatedAt: string
  status: ImportStatus
  detail?: string
  attempt: number
  upload: { sha256: string; bytes: number; fileName?: string }
  report?: {
    appRoot: string
    wrapper?: string
    fileCount: number
    totalBytes: number
    packageName?: string
    viteConfig: string
    reactVersion: string
    viteVersion: string
    warnings: string[]
    skipped: { junk: number; generated: number; outsideRoot: number }
  }
  error?: { code: string; message: string; hint?: string; step?: string; logTail?: string }
  baseVersionId?: string
  task?: ImportTask
  verification?: Verification
  frozenTask?: { hash: string; frozenAt: string }
  experiments: { experimentId: string; taskHash: string; createdAt: string }[]
  preview?: { versionId: string; url: string }
  checkDescriptions: string[]
  checkCaveat: string
  judgedCaveat: string
  /** The saved task has no page checks, so trials are judged against its description. */
  judged?: boolean
  editable?: { total: number; editable: number }
}

export interface RuntimeStatus {
  available: boolean
  image: string
  error?: { code: string; message: string; hint?: string }
}

export interface ImportedElement {
  elementId: string
  screen: string
  role: string
  label?: string
  protected: boolean
  categories: ("signup" | "pricing" | "auth" | "consent" | "validation" | "checker")[]
  supportedOps: ("set_label" | "set_style_token" | "set_order" | "set_visibility")[]
  note?: string
  source: { file: string; line: number; column: number }
}

export interface CheckSuggestions {
  suggestions: { check: SuccessCheck; why: string }[]
  rejected: { proposed: string; reason: string }[]
  model: string
  usd: number
}

type ApiError = { error: { code: string; message: string; hint?: string } }

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, { cache: "no-store", ...init })
  } catch {
    throw new Error("Couldn't reach the GhostLoop worker. Is it running (npm run worker:real)?")
  }
  if (res.status === 502 || res.status === 504) throw new Error("Couldn't reach the GhostLoop worker's import API. Is it running (npm run worker:real)?")
  const body = (await res.json().catch(() => ({}))) as T | ApiError
  if (!res.ok) {
    const e = (body as ApiError).error
    throw new Error(e ? `${e.message}${e.hint ? ` ${e.hint}` : ""}` : `Request failed (${res.status}).`)
  }
  return body as T
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
})

export const importsApi = {
  list: () => call<{ imports: ImportView[]; runtime: RuntimeStatus }>("/api/imports"),
  get: (id: string) => call<ImportView>(`/api/imports/${encodeURIComponent(id)}`),
  upload: (file: File, name: string, figmaUrl: string) => {
    const q = new URLSearchParams({ name, fileName: file.name })
    if (figmaUrl.trim()) q.set("figmaUrl", figmaUrl.trim())
    return call<ImportView>(`/api/imports?${q}`, { method: "POST", headers: { "Content-Type": "application/zip" }, body: file })
  },
  cancel: (id: string) => call<ImportView>(`/api/imports/${id}/cancel`, { method: "POST" }),
  retry: (id: string) => call<ImportView>(`/api/imports/${id}/retry`, { method: "POST" }),
  saveTask: (id: string, task: ImportTask) => call<ImportView>(`/api/imports/${id}/task`, jsonInit("PUT", task)),
  suggestChecks: (id: string, t: Pick<ImportTask, "task" | "startRoute" | "viewport">) =>
    call<CheckSuggestions>(`/api/imports/${id}/suggest-checks`, jsonInit("POST", { task: t.task, startRoute: t.startRoute, viewport: t.viewport })),
  verify: (id: string) => call<ImportView>(`/api/imports/${id}/verify`, { method: "POST" }),
  freeze: (id: string) => call<ImportView>(`/api/imports/${id}/freeze`, { method: "POST" }),
  startExperiment: (id: string, o: { trials: number; maxSteps: number; maxUsd: number; maxMinutes: number; minImprovementPp: number }) =>
    call<{ experimentId: string }>(`/api/imports/${id}/experiments`, jsonInit("POST", o)),
  version: (versionId: string) => call<{ manifest: { elements: ImportedElement[] }; previewUrl: string }>(`/api/import-versions/${versionId}`),
  logUrl: (id: string, step: "install" | "build", versionId?: string) =>
    `/api/imports/${id}/log?step=${step}${versionId ? `&version=${versionId}` : ""}`,
}

const ACTIVE: ImportStatus[] = ["uploading", "validating", "installing", "building", "starting"]
export const isActive = (s: ImportStatus) => ACTIVE.includes(s)

/** Imports list plus runtime status, polled while anything is in progress (and slowly otherwise). */
export function useImports(): { imports: ImportView[]; runtime?: RuntimeStatus; error?: string; refresh: () => void } {
  const [state, setState] = useState<{ imports: ImportView[]; runtime?: RuntimeStatus; error?: string }>({ imports: [] })
  const [tick, setTick] = useState(0)
  const busy = useRef(false)
  useEffect(() => {
    let live = true
    busy.current = true
    importsApi
      .list()
      .then((r) => live && setState({ imports: r.imports, runtime: r.runtime }))
      .catch((e: unknown) => live && setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) })))
      .finally(() => (busy.current = false))
    return () => {
      live = false
    }
  }, [tick])
  const anyActive = state.imports.some((i) => isActive(i.status))
  useEffect(() => {
    const t = window.setTimeout(() => setTick((n) => n + 1), anyActive ? 1000 : 5000)
    return () => window.clearTimeout(t)
  }, [tick, anyActive])
  return { ...state, refresh: useCallback(() => setTick((n) => n + 1), []) }
}

/** Plain-language statement of what a check verifies (mirrors the worker's describeCheck). */
export function describeCheck(c: SuccessCheck): string {
  switch (c.kind) {
    case "route":
      return c.path.startsWith("#")
        ? `The page's URL hash ${c.match === "prefix" ? "starts with" : "is exactly"} ${c.path || "…"}.`
        : `The page's URL path ${c.match === "prefix" ? "starts with" : "is exactly"} ${c.path || "…"} (query and hash ignored).`
    case "text":
      return c.match === "exact"
        ? `Some visible element's text is exactly “${c.text || "…"}” (case and spacing ignored).`
        : `The visible page text contains “${c.text || "…"}” (case and spacing ignored).`
    case "control":
      return `A visible ${c.role} whose accessible name is “${c.name || "…"}” is on the page.`
  }
}

export const STEPS = ["Uploading", "Validating", "Building", "Ready for review", "Ready to test"] as const

export function stepOf(s: ImportStatus): number {
  switch (s) {
    case "uploading":
      return 0
    case "validating":
      return 1
    case "installing":
    case "building":
    case "starting":
      return 2
    case "ready_for_review":
      return 3
    case "ready_to_test":
      return 4
    default:
      return -1
  }
}

/** Imported versions are named `ver_imp_…` by the import service. */
export const isImportedVersion = (versionId: string | undefined) => Boolean(versionId?.startsWith("ver_imp_"))

/** `key=value` lines ↔ record. */
export function parseInputs(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const i = line.indexOf("=")
    if (i <= 0) continue
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}
export const formatInputs = (r: Record<string, string>) =>
  Object.entries(r)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n")
export const lines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)

const CHECK_FIELD = { route: "a route", text: "the text to look for", control: "the control's name" } as const

/** What still has to be filled in before the task can be saved and checked, in the designer's words. */
export function taskProblems(t: ImportTask): string[] {
  const out: string[] = []
  if (t.task.trim().length < 10) out.push("Describe the task in a sentence (at least 10 characters).")
  if (!/^\/(?!\/)\S*$/.test(t.startRoute)) out.push("The starting route must be a path like / or /checkout.")
  t.successChecks.forEach((c, i) => {
    const value = c.kind === "route" ? c.path : c.kind === "text" ? c.text : c.name
    const n = t.successChecks.length > 1 ? ` ${i + 1}` : ""
    if (!value.trim()) out.push(`Success check${n} needs ${CHECK_FIELD[c.kind]}.`)
    else if (c.kind === "route" && !/^(\/|#\/)\S*$/.test(c.path)) out.push(`Success check${n}: a route starts with / (or #/ for hash routes).`)
  })
  return out
}

/** Turns the server's field-path validation messages into plain language. */
export function friendlyError(message: string): string {
  return message
    .split("; ")
    .map((part) =>
      part
        .replace(/^successChecks\.(\d+)\.\w+:/, (_, i: string) => `Success check ${Number(i) + 1}:`)
        .replace(/^successChecks:/, "Success checks:")
        .replace(/^task:/, "Task description:")
        .replace(/^startRoute:/, "Starting route:")
        .replace(/^viewport[.\w]*:/, "Viewport:")
        .replace(/^protectedTexts[.\d]*:/, "Protected text:")
        .replace(/^protectedBehavior[.\d]*:/, "Protected behavior:")
        .replace(/^inputs[.\w]*:/, "Test data:")
        .replace(/String must contain at least 1 character\(s\)/, "can't be empty")
        .replace(/String must contain at most (\d+) character\(s\)/, "must be at most $1 characters"),
    )
    .join(" ")
}
