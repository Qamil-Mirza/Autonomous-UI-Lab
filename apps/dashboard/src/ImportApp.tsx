import { useEffect, useState } from "react"
import { Badge, formatWhen, VersionPreview } from "./ui"
import {
  CONTROL_ROLES,
  STEPS,
  describeCheck,
  formatInputs,
  friendlyError,
  importsApi,
  isActive,
  lines,
  parseInputs,
  stepOf,
  taskProblems,
  useImports,
  type CheckSuggestions,
  type ImportTask,
  type ImportView,
  type RuntimeStatus,
  type SuccessCheck,
} from "./live/imports"

const STATUS: Record<ImportView["status"], [string, string]> = {
  uploading: ["Uploading", "coral"],
  validating: ["Validating", "coral"],
  installing: ["Building · installing dependencies", "coral"],
  building: ["Building", "coral"],
  starting: ["Building · starting preview", "coral"],
  ready_for_review: ["Ready for review", "warn"],
  ready_to_test: ["Ready to test", "good"],
  failed: ["Failed", "bad"],
  cancelled: ["Cancelled", "muted"],
}

const VIEWPORTS: [string, number, number][] = [
  ["Desktop · 1280×800", 1280, 800],
  ["Laptop · 1440×900", 1440, 900],
  ["Tablet · 768×1024", 768, 1024],
  ["Mobile · 390×844", 390, 844],
]

function RuntimeBanner({ runtime }: { runtime?: RuntimeStatus }) {
  if (!runtime || runtime.available) return null
  return (
    <div className="alert bad">
      <b>The isolation runtime is unavailable.</b> {runtime.error?.message} {runtime.error?.hint}
    </div>
  )
}

/** Imports list and the upload form. */
export function ImportsPage({ open }: { open: (id: string) => void }) {
  const { imports, runtime, error, refresh } = useImports()
  const [name, setName] = useState("")
  const [figmaUrl, setFigmaUrl] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState("")
  const [dragging, setDragging] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setFormError("Give the project a name.")
    if (!file) return setFormError("Choose the code ZIP you exported from Figma Make.")
    if (!/\.zip$/i.test(file.name)) return setFormError("The export must be a .zip file.")
    if (file.size > 50 * 1024 * 1024) return setFormError("The ZIP is larger than 50 MB.")
    setFormError("")
    setBusy(true)
    try {
      const rec = await importsApi.upload(file, name.trim(), figmaUrl)
      refresh()
      open(rec.id)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="narrow">
      <div className="page-head">
        <div>
          <small>IMPORT</small>
          <h1>Import a Figma Make app</h1>
          <p>
            Upload the code ZIP from Figma Make (Export → Download code). GhostLoop builds it in an isolated container and
            shows you a live preview before any test runs.
          </p>
        </div>
        <div>
          <Badge tone={!runtime ? "muted" : runtime.available ? "good" : "bad"}>
            {!runtime ? "Checking sandbox…" : runtime.available ? "Sandbox ready" : "Sandbox unavailable"}
          </Badge>
        </div>
      </div>
      <RuntimeBanner runtime={runtime} />
      {error && <div className="alert bad">{error}</div>}
      <form className="card form" onSubmit={submit}>
        {formError && <div className="alert bad">{formError}</div>}
        <div className="field-row">
          <label>
            Project name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Checkout redesign" maxLength={120} />
          </label>
          <label
            className={`dropzone-field${dragging ? " over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              const dropped = e.dataTransfer.files[0]
              if (dropped) setFile(dropped)
            }}
          >
            Code ZIP
            <input className="sr-only" type="file" accept=".zip,application/zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <span className="dropzone">
              <span className="dropzone-icon" aria-hidden="true">
                ⇪
              </span>
              {file ? (
                <span>
                  <b>{file.name}</b>
                  <small>{file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`} · click to change</small>
                </span>
              ) : (
                <span>
                  <b>Choose a .zip file</b>
                  <small>or drop it here · up to 50 MB</small>
                </span>
              )}
            </span>
          </label>
        </div>
        <label>
          Figma Make link <span className="optional">(optional, stored for reference only)</span>
          <input value={figmaUrl} onChange={(e) => setFigmaUrl(e.target.value)} placeholder="https://www.figma.com/make/…" />
        </label>
        <div className="protected">
          <strong>What is supported</strong>
          <p>
            <span>✓</span>Frontend-only React + Vite apps exported from Figma Make, up to 50 MB zipped and 200 MB unzipped.
          </p>
          <p>
            <span>✓</span>Local app state (useState, localStorage). Each simulated user starts with fresh state.
          </p>
          <p>
            <span>✕</span>Hosted backends: network calls from previews to other sites are blocked.
          </p>
          <p>
            <span>✕</span>Changes are not written back to your Figma file; approved edits produce a separate code version.
          </p>
        </div>
        <div className="form-foot">
          <span>Your code runs only inside a sandboxed container, never on this machine directly.</span>
          <button className="btn primary" disabled={busy || runtime?.available === false}>
            {busy ? "Uploading…" : "Upload and build"}
          </button>
        </div>
      </form>
      <section className="section">
        <div className="section-title">
          <div>
            <small>IMPORTED APPS</small>
            <h2>Your imports</h2>
          </div>
        </div>
        <div className="table card">
          <div className="table-row table-head">
            <span>Project</span>
            <span>Status</span>
            <span>Updated</span>
            <span />
          </div>
          {imports.length === 0 && (
            <div className="table-row empty-row">
              <span>No imports yet.</span>
            </div>
          )}
          {imports.map((i) => (
            <button className="table-row" key={i.id} onClick={() => open(i.id)}>
              <span>
                <b>{i.name}</b>
                <small>{i.id}</small>
              </span>
              <span>
                <Badge tone={STATUS[i.status][1]}>{STATUS[i.status][0]}</Badge>
              </span>
              <span>{formatWhen(i.updatedAt)}</span>
              <span>View →</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

function Stepper({ status }: { status: ImportView["status"] }) {
  const active = stepOf(status)
  return (
    <div className="progress">
      {STEPS.map((s, i) => (
        <div className={active >= 0 && i <= active ? "done" : ""} key={s}>
          <span>{active >= 0 && i < active ? "✓" : i + 1}</span>
          <small>{s}</small>
        </div>
      ))}
    </div>
  )
}

const emptyTask = (): ImportTask => ({
  task: "",
  startRoute: "/",
  viewport: { width: 1280, height: 800 },
  successChecks: [],
  protectedTexts: [],
  protectedBehavior: [],
  inputs: {},
  personas: [],
})

function CheckEditor({ check, set, remove }: { check: SuccessCheck; set: (c: SuccessCheck) => void; remove?: () => void }) {
  return (
    <div className="check-row">
      <div className="check-fields">
        <select
          aria-label="Check type"
          value={check.kind}
          onChange={(e) => {
            const kind = e.target.value as SuccessCheck["kind"]
            set(kind === "route" ? { kind, path: "/", match: "exact" } : kind === "text" ? { kind, text: "", match: "contains" } : { kind, role: "button", name: "" })
          }}
        >
          <option value="route">Reaches a route</option>
          <option value="text">Shows text</option>
          <option value="control">Shows a control</option>
        </select>
        {check.kind === "route" && (
          <>
            <select aria-label="Route match" value={check.match} onChange={(e) => set({ ...check, match: e.target.value as "exact" | "prefix" })}>
              <option value="exact">is exactly</option>
              <option value="prefix">starts with</option>
            </select>
            <input aria-label="Route" value={check.path} onChange={(e) => set({ ...check, path: e.target.value })} placeholder="e.g. /order/confirmed" aria-invalid={!check.path.trim()} />
          </>
        )}
        {check.kind === "text" && (
          <>
            <select aria-label="Text match" value={check.match} onChange={(e) => set({ ...check, match: e.target.value as "contains" | "exact" })}>
              <option value="contains">page contains</option>
              <option value="exact">an element is exactly</option>
            </select>
            <input aria-label="Text" value={check.text} onChange={(e) => set({ ...check, text: e.target.value })} placeholder="e.g. Order confirmed" aria-invalid={!check.text.trim()} />
          </>
        )}
        {check.kind === "control" && (
          <>
            <select aria-label="Control role" value={check.role} onChange={(e) => set({ ...check, role: e.target.value as (typeof CONTROL_ROLES)[number] })}>
              {CONTROL_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <input aria-label="Accessible name" value={check.name} onChange={(e) => set({ ...check, name: e.target.value })} placeholder="e.g. Track my order" aria-invalid={!check.name.trim()} />
          </>
        )}
        {remove && (
          <button type="button" className="text-btn" onClick={remove}>
            Remove
          </button>
        )}
      </div>
      <small className="check-desc">Verifies: {describeCheck(check)}</small>
    </div>
  )
}

/** One import: status, errors, preview, task and checks, verification, freezing and the baseline start. */
export function ImportDetail({ id, back, started }: { id: string; back: () => void; started: (experimentId: string, name: string) => void }) {
  const [rec, setRec] = useState<ImportView | undefined>()
  const [loadError, setLoadError] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState<string | undefined>()
  const [task, setTask] = useState<ImportTask>(emptyTask)
  const [protectedText, setProtectedText] = useState("")
  const [behaviorText, setBehaviorText] = useState("")
  const [inputsText, setInputsText] = useState("")
  const [dirty, setDirty] = useState(false)
  const [formError, setFormError] = useState("")
  const [suggested, setSuggested] = useState<CheckSuggestions | undefined>()
  const [suggestError, setSuggestError] = useState("")
  const [run, setRun] = useState({ trials: 6, maxSteps: 12, maxUsd: 10, maxMinutes: 20, minImprovementPp: 10 })

  useEffect(() => {
    let live = true
    let timer = 0
    const load = () =>
      importsApi
        .get(id)
        .then((r) => {
          if (!live) return
          setRec(r)
          setLoadError("")
          timer = window.setTimeout(load, isActive(r.status) ? 1000 : 4000)
        })
        .catch((e: unknown) => {
          if (!live) return
          setLoadError(e instanceof Error ? e.message : String(e))
          timer = window.setTimeout(load, 4000)
        })
    load()
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [id])

  // Load the saved task into the form once (and whenever it changes on the server while the form is clean).
  useEffect(() => {
    if (!rec?.task || dirty) return
    setTask(rec.task)
    setProtectedText(rec.task.protectedTexts.join("\n"))
    setBehaviorText(rec.task.protectedBehavior.join("\n"))
    setInputsText(formatInputs(rec.task.inputs))
  }, [rec?.task, dirty])

  if (!rec) return <div className="loading card">{loadError ? <div className="alert bad">{loadError}</div> : <p>Loading…</p>}</div>

  const act = async (label: string, f: () => Promise<ImportView | void>) => {
    setBusy(label)
    setError("")
    try {
      const r = await f()
      if (r) setRec(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(undefined)
    }
  }
  const edit = (t: ImportTask) => {
    setTask(t)
    setDirty(true)
  }
  const draft = (): ImportTask => ({ ...task, protectedTexts: lines(protectedText), protectedBehavior: lines(behaviorText), inputs: parseInputs(inputsText) })
  const problems = taskProblems(draft())
  const checkKey = (c: SuccessCheck) => JSON.stringify(c)
  const addChecks = (cs: SuccessCheck[]) => {
    const have = new Set(task.successChecks.map(checkKey))
    edit({ ...task, successChecks: [...task.successChecks, ...cs.filter((c) => !have.has(checkKey(c)))].slice(0, 5) })
  }
  const suggest = async () => {
    setBusy("suggest")
    setSuggestError("")
    try {
      setSuggested(await importsApi.suggestChecks(id, task))
    } catch (e) {
      setSuggestError(friendlyError(e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy(undefined)
    }
  }
  const canSuggest = task.task.trim().length >= 10
  /** Saves the form (when it changed) and, with `check`, verifies it against the preview right after. */
  const submitTask = async (check: boolean) => {
    setBusy(check ? "verify" : "save")
    setFormError("")
    setError("")
    try {
      if (dirty || !rec.task) {
        setRec(await importsApi.saveTask(id, draft()))
        setDirty(false)
      }
      if (check) setRec(await importsApi.verify(id))
    } catch (e) {
      setFormError(friendlyError(e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy(undefined)
    }
  }
  const ready = rec.status === "ready_for_review" || rec.status === "ready_to_test"
  const [label, tone] = STATUS[rec.status]
  const v = rec.verification
  const verifiedCurrent = v && rec.task && !dirty
  const previewUrl = rec.preview ? new URL(task.startRoute || "/", rec.preview.url).href : undefined

  return (
    <>
      <div className="page-head">
        <div>
          <small>
            IMPORT · {rec.id} · <button className="text-btn" onClick={back}>All imports</button>
          </small>
          <h1>{rec.name}</h1>
          <p>{rec.detail ?? (rec.status === "ready_to_test" ? "Task frozen. Start a baseline test when ready." : rec.status === "ready_for_review" ? "Check the preview, then describe the task and how success is checked." : "")}</p>
        </div>
        <div>
          <Badge tone={tone}>{label}</Badge>
          {isActive(rec.status) && (
            <button className="btn danger ghost" disabled={busy !== undefined} onClick={() => act("cancel", () => importsApi.cancel(id))}>
              Cancel
            </button>
          )}
          {(rec.status === "failed" || rec.status === "cancelled") && (
            <button className="btn secondary" disabled={busy !== undefined} onClick={() => act("retry", () => importsApi.retry(id))}>
              Retry
            </button>
          )}
        </div>
      </div>
      <Stepper status={rec.status} />
      {error && <div className="alert bad">{error}</div>}
      {loadError && <div className="alert warn">{loadError}</div>}

      {rec.error && (rec.status === "failed" || rec.status === "cancelled") && (
        <div className={`alert ${rec.status === "failed" ? "bad" : "warn"}`}>
          <b>
            {rec.status === "cancelled" ? "Import cancelled" : "Import failed"}
            {rec.error.step ? ` while ${rec.error.step}` : ""} · {rec.error.code}
          </b>
          <p>{rec.error.message}</p>
          {rec.error.hint && <p>{rec.error.hint}</p>}
          {rec.error.logTail && <pre className="log-tail">{rec.error.logTail}</pre>}
          {(rec.error.step === "building" || rec.error.step === "installing") && (
            <a href={importsApi.logUrl(id, rec.error.step === "building" ? "build" : "install")} target="_blank" rel="noreferrer">
              Open the full {rec.error.step === "building" ? "build" : "install"} log ↗
            </a>
          )}
        </div>
      )}

      {rec.report && (
        <div className="card import-report">
          <small>WHAT WAS IMPORTED</small>
          <p>
            {rec.report.fileCount} files ({Math.round(rec.report.totalBytes / 1024)} KB)
            {rec.report.wrapper ? ` from inside “${rec.report.wrapper}/”` : ""}
            {rec.report.appRoot ? `, app root ${rec.report.appRoot}/` : ""} · React {rec.report.reactVersion} · Vite {rec.report.viteVersion} ·{" "}
            {rec.report.viteConfig}
            {rec.editable ? ` · ${rec.editable.editable} of ${rec.editable.total} text elements editable` : ""}
          </p>
          {rec.report.warnings.map((w) => (
            <p className="quality-note" key={w}>
              ⚠ {w}
            </p>
          ))}
          <p className="quality-note">
            Upload {rec.upload.fileName ?? "ZIP"} · sha256 {rec.upload.sha256.slice(0, 12)}… · stored unchanged
            {rec.figmaUrl && (
              <>
                {" "}
                · <a href={rec.figmaUrl} target="_blank" rel="noreferrer">Figma link</a> (reference only)
              </>
            )}
          </p>
        </div>
      )}

      {rec.preview && previewUrl && (
        <section className="section">
          <div className="section-title">
            <div>
              <small>LIVE PREVIEW · ISOLATED · {rec.preview.versionId}</small>
              <h2>Is this the app you meant to test?</h2>
              <p>Rendered from the build sandbox on its own origin ({rec.preview.url}) at the task's viewport.</p>
            </div>
          </div>
          <VersionPreview url={previewUrl} title="Imported app preview" frame={task.viewport} key={`${previewUrl}-${task.viewport.width}`} />
        </section>
      )}

      {ready && (
        <section className="section">
          <div className="section-title">
            <div>
              <small>TASK</small>
              <h2>What should someone be able to do?</h2>
            </div>
            {rec.status === "ready_to_test" && !dirty && <Badge tone="good">Frozen</Badge>}
          </div>
          <form
            className="card form"
            onSubmit={(e) => {
              e.preventDefault()
              void submitTask(true)
            }}
          >
            <label>
              Task description <span className="optional">(the simulated users see exactly this, before and after changes)</span>
              <textarea rows={3} value={task.task} onChange={(e) => edit({ ...task, task: e.target.value })} placeholder="e.g. Order one flat white for pickup and get it confirmed." />
            </label>
            <div className="field-row">
              <label>
                Starting route
                <input value={task.startRoute} onChange={(e) => edit({ ...task, startRoute: e.target.value })} placeholder="/" />
              </label>
              <label>
                Viewport
                <select
                  value={`${task.viewport.width}x${task.viewport.height}`}
                  onChange={(e) => {
                    const [w, h] = e.target.value.split("x").map(Number)
                    edit({ ...task, viewport: { width: w!, height: h! } })
                  }}
                >
                  {VIEWPORTS.map(([l, w, h]) => (
                    <option key={l} value={`${w}x${h}`}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="protected">
              <div className="success-mode">
                <div>
                  <strong>How success is decided</strong>
                  <p className="judged-note">
                    {task.successChecks.length === 0
                      ? "Judged against your task description. A separate Claude judge reads each trial's actions and screenshots; the simulated user and the model proposing changes can't declare success. Add checks for verified results."
                      : "Verified by page checks: GhostLoop evaluates these on the page the simulated user ends up on, and all must pass. No model decides success."}
                  </p>
                </div>
                <Badge tone={task.successChecks.length === 0 ? "warn" : "good"}>{task.successChecks.length === 0 ? "Judged" : "Verified"}</Badge>
              </div>
              {task.successChecks.map((c, i) => (
                <CheckEditor
                  key={i}
                  check={c}
                  set={(n) => edit({ ...task, successChecks: task.successChecks.map((x, j) => (j === i ? n : x)) })}
                  remove={() => edit({ ...task, successChecks: task.successChecks.filter((_, j) => j !== i) })}
                />
              ))}
              <div className="check-actions">
                <button type="button" className="btn secondary" disabled={!canSuggest || busy !== undefined} onClick={() => void suggest()}>
                  {busy === "suggest" ? "Suggesting…" : "Suggest checks"}
                </button>
                {task.successChecks.length < 5 && (
                  <button type="button" className="text-btn" onClick={() => edit({ ...task, successChecks: [...task.successChecks, { kind: "text", text: "", match: "contains" }] })}>
                    + Add a check manually
                  </button>
                )}
                {!canSuggest && <small className="check-desc">Describe the task first; suggestions read it.</small>}
              </div>
              {suggestError && <div className="alert bad">{suggestError}</div>}
              {suggested && (
                <div className="suggestions">
                  {suggested.suggestions.length === 0 ? (
                    <p className="check-desc">
                      No usable checks found: the app shows no distinctive text or route for the finished task. Judging against the description still works.
                    </p>
                  ) : (
                    <>
                      <div className="suggestions-head">
                        <b>Suggested checks</b>
                        <button type="button" className="text-btn" onClick={() => addChecks(suggested.suggestions.map((x) => x.check))}>
                          Add all
                        </button>
                      </div>
                      {suggested.suggestions.map((x) => {
                        const added = task.successChecks.some((c) => checkKey(c) === checkKey(x.check))
                        return (
                          <div className="suggestion" key={checkKey(x.check)}>
                            <div>
                              <b>{describeCheck(x.check)}</b>
                              {x.why && <small>{x.why}</small>}
                            </div>
                            <button type="button" className="btn secondary" disabled={added} onClick={() => addChecks([x.check])}>
                              {added ? "Added" : "Add"}
                            </button>
                          </div>
                        )
                      })}
                    </>
                  )}
                  {suggested.rejected.length > 0 && (
                    <details className="check-desc">
                      <summary>
                        {suggested.rejected.length} proposal{suggested.rejected.length === 1 ? "" : "s"} set aside
                      </summary>
                      <ul>
                        {suggested.rejected.map((r, k) => (
                          <li key={k}>
                            {r.reason} <code>{r.proposed}</code>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <small className="check-desc">
                    Suggested by {suggested.model} from your task, the starting page and the app's own text and routes; checks
                    that already pass at the start are set aside.
                  </small>
                </div>
              )}
              <p className="quality-note">{task.successChecks.length === 0 ? rec.judgedCaveat : rec.checkCaveat}</p>
            </div>
            <div className="field-row">
              <label>
                Protected text <span className="optional">(one per line; never edited)</span>
                <textarea rows={3} value={protectedText} onChange={(e) => (setProtectedText(e.target.value), setDirty(true))} placeholder={"e.g. Order confirmed\nTotal"} />
              </label>
              <label>
                Protected behavior <span className="optional">(one per line; constraints for suggestions)</span>
                <textarea rows={3} value={behaviorText} onChange={(e) => (setBehaviorText(e.target.value), setDirty(true))} placeholder="e.g. Removing items from the bag keeps working." />
              </label>
            </div>
            <label>
              Test data the simulated users may type <span className="optional">(key=value per line; fictional values only)</span>
              <textarea rows={2} value={inputsText} onChange={(e) => (setInputsText(e.target.value), setDirty(true))} placeholder={"e.g. name=Pat Example\nemail=pat@example.com"} />
            </label>
            {problems.length > 0 && (
              <div className="alert warn task-todo" role="status">
                <b>Before checking, fill in:</b>
                <ul>
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
            {formError && (
              <div className="alert bad" role="alert">
                <b>Couldn't {busy === "save" || !rec.task || dirty ? "save" : "check"} the task.</b> {formError}
              </div>
            )}
            <div className="form-foot">
              <span>{dirty ? "Unsaved changes; checking saves them first." : rec.task ? "Saved." : "Not saved yet."}</span>
              <div className="form-actions">
                <button type="button" className="btn secondary" disabled={busy !== undefined || problems.length > 0 || (!dirty && Boolean(rec.task))} onClick={() => void submitTask(false)}>
                  {busy === "save" ? "Saving…" : "Save task"}
                </button>
                <button className="btn primary" disabled={busy !== undefined || problems.length > 0}>
                  {busy === "verify" ? "Checking the preview…" : dirty || !rec.task ? "Save and check" : "Check preview and task"}
                </button>
              </div>
            </div>
          </form>
        </section>
      )}

      {ready && v && verifiedCurrent && (
        <section className="section">
          <div className="section-title">
            <div>
              <small>VERIFICATION · {new Date(v.at).toLocaleTimeString()}</small>
              <h2>{v.ok ? "The preview and task look right" : "Fix these before testing"}</h2>
              <p>A fresh browser opened {v.url} at the task's viewport.</p>
            </div>
            <Badge tone={v.ok ? "good" : "bad"}>{v.ok ? "Ready to freeze" : "Blocked"}</Badge>
          </div>
          {v.blockers.map((b) => (
            <div className="alert bad" key={b}>
              {b}
            </div>
          ))}
          {v.warnings.map((w) => (
            <div className="alert warn" key={w}>
              {w}
            </div>
          ))}
          <div className="verify-grid">
            {v.screenshot && <img className="card verify-shot" src={v.screenshot} alt="What a simulated user sees at the starting route" />}
            <div className="card verify-list">
              <b>{v.checks.length ? "What each check says at the start" : "Success is judged"}</b>
              {v.checks.length === 0 && <p>No page checks: Claude will judge each trial against your task description.</p>}
              {v.checks.map((c) => (
                <p key={c.name}>
                  <Badge tone={c.passedAtStart ? "warn" : "muted"}>{c.passedAtStart ? "Passes already" : "Not yet"}</Badge> {c.description}
                </p>
              ))}
              <b>Controls a simulated user can act on ({v.controls.length})</b>
              <ul className="control-list">
                {v.controls.slice(0, 30).map((c) => (
                  <li key={c.ref}>
                    <code>{c.role}</code> {c.label || <i>unnamed</i>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          {rec.status !== "ready_to_test" && (
            <div className="next-step card">
              <div>
                <small>FREEZE</small>
                <h3>Freeze this task and its checks</h3>
                <p>The baseline and every retest use exactly this wording, route, viewport and success definition. Changing them later needs a new freeze.</p>
              </div>
              <button className="btn primary" disabled={!v.ok || busy !== undefined} onClick={() => act("freeze", () => importsApi.freeze(id))}>
                {busy === "freeze" ? "Freezing…" : "Freeze and continue"}
              </button>
            </div>
          )}
        </section>
      )}

      {rec.status === "ready_to_test" && !dirty && (
        <section className="section">
          <div className="section-title">
            <div>
              <small>BASELINE · task {rec.frozenTask?.hash.slice(0, 12)}</small>
              <h2>Run the baseline test</h2>
              <p>Real simulated users (Playwright + the configured model) try the task on this preview. Each trial is a fresh browser.</p>
            </div>
          </div>
          <form
            className="card form"
            onSubmit={(e) => {
              e.preventDefault()
              void act("start", async () => {
                const { experimentId } = await importsApi.startExperiment(id, run)
                started(experimentId, rec.name)
              })
            }}
          >
            <div className="field-row">
              <label>
                Number of trials
                <input type="number" min={1} max={100} value={run.trials} onChange={(e) => setRun({ ...run, trials: e.target.valueAsNumber })} />
              </label>
              <label>
                Maximum steps per trial
                <input type="number" min={1} max={20} value={run.maxSteps} onChange={(e) => setRun({ ...run, maxSteps: e.target.valueAsNumber })} />
              </label>
            </div>
            <div className="field-row">
              <label>
                Cost limit (USD)
                <input type="number" min={0} value={run.maxUsd} onChange={(e) => setRun({ ...run, maxUsd: e.target.valueAsNumber })} />
              </label>
              <label>
                Time limit (minutes)
                <input type="number" min={1} value={run.maxMinutes} onChange={(e) => setRun({ ...run, maxMinutes: e.target.valueAsNumber })} />
              </label>
            </div>
            <div className="form-foot">
              <span>Uses live model calls. Suggestions always wait for your approval.</span>
              <button className="btn primary" disabled={busy !== undefined}>
                {busy === "start" ? "Starting…" : "Start the baseline test"}
              </button>
            </div>
          </form>
        </section>
      )}

      {rec.experiments.length > 0 && (
        <section className="section">
          <div className="section-title">
            <div>
              <small>EXPERIMENTS</small>
              <h2>Tests on this import</h2>
            </div>
          </div>
          <div className="table card">
            {rec.experiments.map((x) => (
              <button className="table-row" key={x.experimentId} onClick={() => started(x.experimentId, rec.name)}>
                <span>
                  <b>{x.experimentId}</b>
                  <small>task {x.taskHash.slice(0, 12)}</small>
                </span>
                <span>{new Date(x.createdAt).toLocaleString()}</span>
                <span />
                <span>View →</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  )
}
