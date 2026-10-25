import { useEffect, useMemo, useRef, useState } from "react"
import type { ObservationDisposition } from "@ghostloop/contracts"
import { experiment } from "./sampleData"
import { sampleAdapter } from "./mockService"
import { sampleSummaries, sampleView, type SampleScenario } from "./sample"
import { useElements, useGhostloop, useNames, type LinkStatus } from "./live/useGhostloop"
import { usePreview } from "./live/usePreview"
import { experimentView, summaries, type ExperimentSummary, type ExperimentView, type RunView } from "./live/view"
import { buildCreatePayload, DEFAULT_PROTOTYPE_URL, fetchManifest, LIMITS, parsePrototypeUrl, validateForm, type SetupForm } from "./live/setup"

type View = "landing" | "overview" | "setup" | "runs" | "recommendations" | "review" | "results"

function Logo() {
  return (
    <div className="logo" aria-label="GhostLoop">
      ghostl<span>oo</span>p
    </div>
  )
}

function Mascot({ small = false }: { small?: boolean }) {
  return (
    <div className={small ? "mascot small" : "mascot"}>
      <img src="/assets/ghostloop-mascot.png" alt="GhostLoop ghost mascot" />
    </div>
  )
}

function Badge({
  children,
  tone = "muted",
}: {
  children: React.ReactNode
  tone?: string
}) {
  return <span className={`badge ${tone}`}>{children}</span>
}

function Landing({ open }: { open: () => void }) {
  const [accountOpen, setAccountOpen] = useState(false)
  return (
    <main className="landing">
      <header className="landing-header">
        <Logo />
        <div className="header-controls">
          <div className="account-control">
            <button
              className="account-button"
              type="button"
              aria-expanded={accountOpen}
              onClick={() => setAccountOpen(!accountOpen)}
            >
              <span>AM</span>
              <b>Alex Morgan</b>
              <i aria-hidden="true">⌄</i>
            </button>
            {accountOpen && (
              <div className="account-popover">
                <b>Alex Morgan</b>
                <span>alex@example.test</span>
                <small>Demo account</small>
              </div>
            )}
          </div>
        </div>
      </header>
      <section className="hero">
        <div className="hero-copy">
          <Badge tone="coral">Thoughtful testing, on repeat</Badge>
          <h1>
            Find where users get stuck. <em>Test what helps.</em>
          </h1>
          <p>
            Watch simulated users navigate your website, review suggested
            changes, and retest them with you in control.
          </p>
          <button className="btn primary large" onClick={open}>
            Open dashboard <span aria-hidden>→</span>
          </button>
        </div>
        <div className="hero-art">
          <div className="loop loop-one" />
          <div className="loop loop-two" />
          <Mascot />
        </div>
      </section>
      <section className="steps" aria-label="How GhostLoop works">
        {["Run simulated users", "Review a change", "Retest and compare"].map(
          (x, i) => (
            <div className="step" key={x}>
              <span>0{i + 1}</span>
              <strong>{x}</strong>
              <p>
                {
                  [
                    "Observe real paths through a defined task.",
                    "See what happened and choose what to try.",
                    "Check whether the new version works better.",
                  ][i]
                }
              </p>
            </div>
          ),
        )}
      </section>
    </main>
  )
}

/** Only the offline sample demo is labeled; a lost connection shows a banner in the page instead. */
function LinkFoot({ link, retry }: { link: LinkStatus; retry: () => void }) {
  if (link.kind !== "offline") return null
  return (
    <div className="sidebar-foot">
      <span className="pulse-dot" />
      Demo · Sample data
      <button className="text-btn foot-retry" onClick={retry}>
        Connect to GhostLoop
      </button>
    </div>
  )
}

function Sidebar({
  view,
  setView,
  recommendationsAvailable,
  hasExperiment,
  link,
  retry,
}: {
  view: View
  setView: (v: View) => void
  recommendationsAvailable: boolean
  hasExperiment: boolean
  link: LinkStatus
  retry: () => void
}) {
  return (
    <aside className="sidebar">
      <Logo />
      <nav>
        <button
          className={view === "overview" ? "active" : ""}
          onClick={() => setView("overview")}
        >
          Overview
        </button>
        <button
          className={
            ["setup", "runs", "review", "results"].includes(view)
              ? "active"
              : ""
          }
          onClick={() => setView(hasExperiment ? "runs" : "setup")}
        >
          Tests
        </button>
        {recommendationsAvailable && (
          <button
            className={view === "recommendations" ? "active" : ""}
            onClick={() => setView("recommendations")}
          >
            Recommendations
          </button>
        )}
      </nav>
      <LinkFoot link={link} retry={retry} />
    </aside>
  )
}

const stages = [
  "First test",
  "What happened",
  "Your review",
  "Test the update",
  "Compare",
]
function Progress({ active }: { active: number }) {
  return (
    <div className="progress">
      {stages.map((s, i) => (
        <div className={i <= active ? "done" : ""} key={s}>
          <span>{i < active ? "✓" : i + 1}</span>
          <small>{s}</small>
        </div>
      ))}
    </div>
  )
}

function SubjectPreview({ selected = [] }: { selected?: string[] }) {
  const clearerLabel = selected.includes("patch_01")
  const strongerStyle = selected.includes("patch_02")
  return (
    <div className="subject">
      <div className="subject-top">
        <i />
        <i />
        <i />
        <b>Acme</b>
        <span>Step 2 of 3</span>
      </div>
      <div className="subject-body">
        <small>CHOOSE YOUR PLAN</small>
        <h3>Start with the plan that fits</h3>
        <div className="plans">
          <div>
            <b>Pro</b>
            <strong>$18</strong>
            <button disabled>Start trial</button>
          </div>
          <div className="free">
            <Badge tone="coral">YOUR SELECTION</Badge>
            <b>Free</b>
            <strong>$0</strong>
            <button disabled className={strongerStyle ? "changed" : ""}>
              {clearerLabel ? "Continue with Free plan" : "Continue"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SessionReplay({ run }: { run: RunView }) {
  const secondsPerAction = 3
  const duration = run.actions.length * secondsPerAction
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const frame = useRef<number | null>(null)
  const previous = useRef<number | null>(null)

  useEffect(() => {
    if (!playing) return
    const tick = (now: number) => {
      if (previous.current !== null) {
        setTime((current) => {
          const next = current + ((now - previous.current!) / 1000) * speed
          if (next >= duration) {
            setPlaying(false)
            return duration
          }
          return next
        })
      }
      previous.current = now
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current)
      previous.current = null
    }
  }, [playing, speed])

  const actionIndex = Math.min(
    Math.floor(time / secondsPerAction),
    run.actions.length - 1,
  )
  const action = run.actions[actionIndex]
  const phase = (time % secondsPerAction) / secondsPerAction
  const isSignup =
    action.target === "Account form" ||
    (action.target === "Create account" && phase > 0.68)
  const isWelcome = action.target === "Create account" && !isSignup
  const isWorkspace = action.target === "Continue" && phase > 0.68
  const isInvite = action.target.includes("teammate")
  const showTrialDialog = action.target === "Start trial" && phase > 0.55
  const friction =
    action.action.includes("back") || action.result.includes("limit")
  const cursor = isWelcome
    ? { left: "50%", top: "67%" }
    : isSignup
      ? { left: "50%", top: "73%" }
      : isInvite
        ? { left: "50%", top: "69%" }
        : isWorkspace
          ? { left: "51%", top: "70%" }
          : action.target.includes("Free")
            ? { left: "70%", top: "61%" }
            : action.target === "Start trial"
              ? { left: "31%", top: "72%" }
              : { left: "72%", top: "72%" }
  const finished = time >= duration - 0.2

  const restart = () => {
    setTime(0)
    setPlaying(true)
  }

  return (
    <div className="replay">
      <div className="replay-stage">
        <div className="replay-label">
          <span className="record-dot" />
          Illustrative session replay · Sample data
        </div>
        <div className="replay-chapter">
          <small>
            STEP {actionIndex + 1} OF {run.actions.length} · {run.id}
          </small>
          <b>
            {action.action} · {action.target}
          </b>
        </div>
        <div className="replay-browser">
          <div className="replay-toolbar">
            <i />
            <i />
            <i />
            <span>
              acme-onboarding.example/
              {isWelcome
                ? ""
                : isSignup
                  ? "signup"
                  : isWorkspace
                    ? "workspace/new"
                    : isInvite
                      ? "workspace/invite"
                      : "plans"}
            </span>
          </div>
          {isWelcome ? (
            <div className="replay-content replay-welcome">
              <Badge tone="coral">WORK BETTER, TOGETHER</Badge>
              <h3>One place for your team’s best work.</h3>
              <p>Create a workspace, invite your team, and get started.</p>
              <button disabled>Create account</button>
            </div>
          ) : isSignup ? (
            <div className="replay-content replay-form">
              <small>CREATE YOUR ACCOUNT</small>
              <h3>Welcome to Acme</h3>
              <p>Use fictional details for this sample trial.</p>
              <label>
                Work email
                <span>maya@example.test</span>
              </label>
              <label>
                Password
                <span>••••••••••••</span>
              </label>
              <button disabled>Create account</button>
            </div>
          ) : isWorkspace ? (
            <div className="replay-content replay-form">
              <small>CREATE A WORKSPACE</small>
              <h3>Name your workspace</h3>
              <p>You can change this later.</p>
              <label>
                Workspace name
                <span>Northstar Studio</span>
              </label>
              <button disabled>Continue</button>
            </div>
          ) : isInvite ? (
            <div className="replay-content replay-form">
              <small>INVITE YOUR TEAM</small>
              <h3>Your workspace is ready</h3>
              <p>Invite one fictional teammate to finish setup.</p>
              <label>
                Teammate email
                <span>teammate@example.test</span>
              </label>
              <button disabled>
                {phase > 0.68 ? "Invitation sent" : "Send invitation"}
              </button>
            </div>
          ) : (
            <div className="replay-content">
              <small>CHOOSE YOUR PLAN</small>
              <h3>Start with the plan that fits</h3>
              <p>You can change your plan later.</p>
              <div className="replay-plans">
                <div className={friction ? "attention" : ""}>
                  <b>Pro</b>
                  <strong>$18</strong>
                  <small>per member / month</small>
                  <button disabled>Start trial</button>
                </div>
                <div className="free">
                  <Badge tone="coral">YOUR SELECTION</Badge>
                  <b>Free</b>
                  <strong>$0</strong>
                  <small>for small teams</small>
                  <button disabled>Continue</button>
                </div>
              </div>
              {showTrialDialog && (
                <div className="trial-dialog">
                  <b>Start your Pro trial?</b>
                  <p>This would begin a paid-plan trial.</p>
                  <button disabled>Not now</button>
                </div>
              )}
            </div>
          )}
        </div>
        <span className="replay-cursor" style={cursor} aria-hidden="true">
          <span />
        </span>
        {phase > 0.42 && phase < 0.66 && (
          <span className="click-ring" style={cursor} aria-hidden="true" />
        )}
        {!finished && (
          <div className={`replay-result ${friction ? "warn" : "good"}`}>
            {action.result}
          </div>
        )}
        {finished && (
          <div className={`replay-outcome ${run.tone}`}>{run.outcome}</div>
        )}
      </div>
      <div className="replay-markers" aria-hidden="true">
        {run.actions.map((item, index) => (
          <span
            key={`${item.action}-${index}`}
            style={{ left: `${((index + 0.5) / run.actions.length) * 100}%` }}
          >
            {index + 1}
          </span>
        ))}
      </div>
      <div className="replay-controls">
        <button
          type="button"
          onClick={() => (time === duration ? restart() : setPlaying(!playing))}
        >
          {time === duration ? "Replay" : playing ? "Pause" : "Play"}
        </button>
        <span>
          {formatTime(time)} / {formatTime(duration)}
        </span>
        <input
          type="range"
          min="0"
          max={duration}
          step=".05"
          value={time}
          aria-label="Replay position"
          onChange={(event) => {
            setTime(Number(event.target.value))
            setPlaying(false)
          }}
        />
        <label>
          Speed
          <select
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
          >
            <option value=".5">0.5×</option>
            <option value="1">1×</option>
            <option value="2">2×</option>
          </select>
        </label>
      </div>
    </div>
  )
}

function formatTime(value: number) {
  return `0:${Math.floor(value).toString().padStart(2, "0")}`
}

/** Steps through a real run's screenshots alongside its actions. */
function LiveReplay({ run }: { run: RunView }) {
  const shots = run.actions.map((a, i) => ({ ...a, step: i + 1 })).filter((a) => a.screenshot)
  const [index, setIndex] = useState(0)
  const shot = shots[Math.min(index, shots.length - 1)]
  if (!shot) return null
  return (
    <div className="replay live-replay">
      <div className="replay-stage">
        <div className="replay-label">
          <span className="record-dot" />
          Recorded screenshots · {run.id}
        </div>
        <img src={shot.screenshot} alt={`Screen before step ${shot.step}: ${shot.action} ${shot.target}`} />
      </div>
      <div className="replay-controls">
        <button type="button" disabled={index === 0} onClick={() => setIndex(index - 1)}>
          Previous
        </button>
        <span>
          Step {shot.step} · {shot.action} · {shot.target}
        </span>
        <button type="button" disabled={index >= shots.length - 1} onClick={() => setIndex(index + 1)}>
          Next
        </button>
      </div>
    </div>
  )
}

const FRAME = { width: 1280, height: 800 }

/** A live view of a prototype version, rendered at desktop size and scaled down to fit its column. */
function VersionPreview({ url, title }: { url: string; title: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.5)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const fit = () => setScale(el.clientWidth / FRAME.width)
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return (
    <div className="subject version-preview">
      <div className="subject-top">
        <i />
        <i />
        <i />
        <b>{new URL(url).pathname}</b>
        <a href={url} target="_blank" rel="noreferrer">
          Open ↗
        </a>
      </div>
      <div className="frame-box" ref={box} style={{ height: FRAME.height * scale }}>
        <iframe
          src={url}
          title={title}
          sandbox="allow-scripts allow-same-origin allow-forms"
          style={{ width: FRAME.width, height: FRAME.height, transform: `scale(${scale})` }}
        />
      </div>
    </div>
  )
}

function ErrorNote({ error }: { error?: string }) {
  return error ? <div className="alert bad">{error}</div> : null
}

function Overview({
  experiments,
  open,
  newTest,
  live,
}: {
  experiments: ExperimentSummary[]
  open: (id: string) => void
  newTest: () => void
  live: boolean
}) {
  return (
    <>
      <div className="welcome card">
        <div>
          <Badge tone="coral">WELCOME BACK</Badge>
          <h1>Ready for another loop?</h1>
          <p>
            Set a goal, see where people may get stuck, and choose which
            improvements to try.
          </p>
          <button className="btn primary" onClick={newTest}>
            Start a new test
          </button>
        </div>
        <Mascot small />
      </div>
      <section className="section">
        <div className="section-title">
          <div>
            <small>RECENT ACTIVITY</small>
            <h2>Your tests</h2>
          </div>
        </div>
        <div className="table card">
          <div className="table-row table-head">
            <span>Test</span>
            <span>Status</span>
            <span>Last updated</span>
            <span />
          </div>
          {experiments.length === 0 && (
            <div className="table-row empty-row">
              <span>{live ? "No tests yet. Start one to see it here." : "No tests."}</span>
            </div>
          )}
          {experiments.map((x) => (
            <button className="table-row" key={x.id} onClick={() => open(x.id)}>
              <span>
                <b>{x.name}</b>
                <small>{x.id}</small>
              </span>
              <Badge tone={x.statusTone}>{x.statusLabel}</Badge>
              <span>{live ? formatWhen(x.updatedAt) : x.updatedAt}</span>
              <span>View →</span>
            </button>
          ))}
        </div>
      </section>
    </>
  )
}

function formatWhen(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const today = new Date().toDateString() === d.toDateString()
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  return today ? `Today, ${time}` : `${d.toLocaleDateString()}, ${time}`
}

const DEFAULT_FORM: SetupForm = {
  url: DEFAULT_PROTOTYPE_URL,
  task: experiment.task,
  trials: 12,
  maxSteps: 20,
  minImprovementPp: 10,
  maxUsd: 20,
  maxMinutes: 15,
  manualReview: true,
}

function Setup({
  start,
  live,
}: {
  start: (name: string, form: SetupForm) => Promise<string | undefined>
  live: boolean
}) {
  const [name, setName] = useState(experiment.name)
  const [form, setForm] = useState<SetupForm>({
    ...DEFAULT_FORM,
    url: live ? DEFAULT_FORM.url : experiment.prototypeUrl,
  })
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof SetupForm>(key: K, value: SetupForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }))
  const num = (key: "trials" | "maxSteps" | "minImprovementPp" | "maxUsd" | "maxMinutes") => ({
    value: Number.isNaN(form[key]) ? "" : String(form[key]),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(key, e.target.valueAsNumber),
  })
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setError("Add a test name.")
    if (live) {
      const invalid = validateForm(form)
      if (invalid) return setError(invalid)
    } else if (!/^https?:\/\//.test(form.url)) {
      return setError("Add a test name and a valid website or prototype URL.")
    }
    setError("")
    setBusy(true)
    const failure = await start(name.trim(), form)
    setBusy(false)
    if (failure) setError(failure)
  }
  return (
    <div className="narrow">
      <div className="page-head">
        <div>
          <small>NEW TEST</small>
          <h1>What should someone be able to do?</h1>
          <p>
            Describe the goal in everyday language. GhostLoop will try the
            journey and show you what happened.
          </p>
        </div>
        <Badge>Draft</Badge>
      </div>
      <form className="card form" onSubmit={submit}>
        {error && <div className="alert bad">{error}</div>}
        <div className="field-row">
          <label>
            Test name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Prototype URL
            <input value={form.url} onChange={(e) => set("url", e.target.value)} />
          </label>
        </div>
        <label>
          Task description
          <textarea rows={4} value={form.task} onChange={(e) => set("task", e.target.value)} />
        </label>
        <div className="field-row">
          <label>
            Number of test trials
            <input type="number" min="1" max={LIMITS.trials} {...num("trials")} />
          </label>
          <label>
            Maximum steps per trial
            <input type="number" min="1" max={LIMITS.maxSteps} {...num("maxSteps")} />
          </label>
        </div>
        <details>
          <summary>
            Advanced settings <span>Margins and limits</span>
          </summary>
          <div className="field-row">
            <label>
              Minimum improvement (percentage points)
              <input type="number" min="0" step="1" {...num("minImprovementPp")} />
            </label>
            <label>
              Cost limit (USD)
              <input type="number" min="0" step="1" {...num("maxUsd")} />
            </label>
          </div>
          <label>
            Time limit (minutes)
            <input type="number" min="1" step="1" {...num("maxMinutes")} />
          </label>
        </details>
        <label className="check">
          <input
            type="checkbox"
            checked={form.manualReview}
            onChange={(e) => set("manualReview", e.target.checked)}
          />
          <span>
            <b>Manual review enabled</b>
            <small>Ask me before testing any suggested improvements.</small>
          </span>
        </label>
        <div className="protected">
          <strong>Protected requirements</strong>
          {[
            "Account creation and authentication stay intact.",
            "Prices and plan rules stay intact.",
            "Required consent and validation stay intact.",
            "Success is independently verified from application state.",
          ].map((x) => (
            <p key={x}>
              <span>✓</span>
              {x}
            </p>
          ))}
        </div>
        <div className="form-foot">
          <span>
            {live
              ? "Simulated users will run against this prototype version."
              : "Test trials use labeled sample data in this demo."}
          </span>
          <button className="btn primary" disabled={busy}>
            {busy ? "Starting…" : "Start the first test"}
          </button>
        </div>
      </form>
    </div>
  )
}

function Runs({
  view,
  cancel,
  review,
  error,
}: {
  view: ExperimentView
  cancel: () => void
  review: () => void
  error?: string
}) {
  const batch = view.baseline
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const selected = batch.runs.find((r) => r.id === selectedId) ?? batch.runs[0]
  const running = view.state === "created" || view.state === "baseline_running"
  const cancelled = view.cancelRequested || (view.stopped && view.stage === 0)
  const ready = view.stage >= 1 && !cancelled
  return (
    <>
      <div className="page-head">
        <div>
          <small>TEST · {view.id}</small>
          <h1>{view.name}</h1>
          <p>
            {cancelled
              ? "Stopped by user"
              : running
                ? `Your first test is running · ${batch.completed} of ${batch.planned} trials finished`
                : "First test complete · findings are ready"}
          </p>
        </div>
        <div>
          <Badge tone={running && !cancelled ? "coral" : view.statusTone}>
            {running && !cancelled ? `Running · ${batch.progress}%` : view.statusLabel}
          </Badge>
          {!cancelled && !view.stopped && (
            <button className="btn danger ghost" onClick={cancel}>
              Stop test
            </button>
          )}
        </div>
      </div>
      <Progress active={view.stage} />
      <ErrorNote error={error} />
      {cancelled && (
        <div className="alert bad">
          <b>Test stopped.</b> Completed trials are still available. No
          updated version was created.
        </div>
      )}
      <div className="metrics">
        {[
          [String(batch.completed), "Completed trials"],
          [String(batch.successes), "Verified successes"],
          [String(batch.behavioralFailures), "Behavioral failures"],
          [String(batch.infraErrors), `Infrastructure error${batch.infraErrors === 1 ? "" : "s"}`],
          [String(batch.cancelled), "Cancellations"],
        ].map((x) => (
          <div className="card" key={x[1]}>
            <strong>{x[0]}</strong>
            <span>{x[1]}</span>
          </div>
        ))}
      </div>
      <div className="evidence-grid">
        <div className="run-list card">
          <div className="card-head">
            <b>Test trials</b>
            <Badge>{batch.planned} total</Badge>
          </div>
          {batch.runs.length === 0 && (
            <div className="no-shot">
              <b>Waiting for the first trial</b>
              <span>Trials appear here as simulated users start.</span>
            </div>
          )}
          {batch.runs.map((r) => (
            <button
              key={r.id}
              className={selected?.id === r.id ? "selected" : ""}
              onClick={() => setSelectedId(r.id)}
            >
              <span>
                <b>{r.label}</b>
                <small>{r.id}</small>
              </span>
              <Badge tone={r.tone}>{r.outcome}</Badge>
            </button>
          ))}
        </div>
        {selected && (
          <div className="run-detail card">
            <div className="card-head">
              <div>
                <b>{selected.label}</b>
                <small>{selected.id}</small>
              </div>
              <Badge tone={selected.tone}>{selected.outcome}</Badge>
            </div>
            {selected.illustrative ? (
              <SessionReplay key={selected.id} run={selected} />
            ) : selected.actions.some((a) => a.screenshot) ? (
              <LiveReplay key={selected.id} run={selected} />
            ) : (
              <div className="no-shot">
                <b>No screenshot available</b>
                <span>
                  {selected.running
                    ? "This trial is still running."
                    : "No replay was captured for this trial."}
                </span>
              </div>
            )}
            <h3>Action timeline</h3>
            <ol className="timeline">
              {selected.actions.map((a, i) => (
                <li key={i}>
                  <span>{i + 1}</span>
                  <div>
                    <b>
                      {a.action} · {a.target}
                    </b>
                    <small>{a.result}</small>
                  </div>
                </li>
              ))}
            </ol>
            <div className={`outcome ${selected.tone}`}>
              <b>{selected.running ? "Status" : "Final outcome"}</b>
              <span>{selected.outcome}</span>
            </div>
          </div>
        )}
      </div>
      {ready && (
        <div className="next-step card">
          <div>
            <small>NEXT STEP</small>
            <h3>
              {view.stage === 1
                ? "GhostLoop is analyzing the trials"
                : `See the patterns across all ${batch.completed} trials`}
            </h3>
            <p>
              Recommendations combines the trial results and suggests focused
              improvements.
            </p>
          </div>
          <button className="btn primary" onClick={review} disabled={view.stage === 1}>
            {view.stage === 1 ? "Analyzing…" : "View recommendations"}
          </button>
        </div>
      )}
    </>
  )
}

const DISPOSITIONS: [ObservationDisposition, string][] = [
  ["unreviewed", "Not reviewed yet"],
  ["confirmed", "Worth testing"],
  ["intentional", "Expected behavior"],
  ["not_relevant", "Not relevant"],
]

function Recommendations({
  view,
  review,
  setDisposition,
  error,
}: {
  view: ExperimentView
  review: () => void
  setDisposition: (observationId: string, d: ObservationDisposition) => void
  error?: string
}) {
  const b = view.baseline
  const total = b.completed || 1
  const share = (n: number) => `${Math.round((n / total) * 1000) / 10}%`
  // Only patterns with a suggested change are listed; prefer a suggestion that can actually be approved.
  const suggested = view.observations.flatMap((o) => {
    const cited = view.patches.filter((p) => p.observationIds.includes(o.id))
    const suggestion = cited.find((p) => !p.blocked) ?? cited[0]
    return suggestion ? [{ o, suggestion }] : []
  })
  const breakdown: [string, number, string][] = [
    ["Goal completed", b.successes, "good"],
    ["Could not finish the journey", b.behavioralFailures, "warn"],
    ["Technical error", b.infraErrors, "muted"],
  ]
  return (
    <>
      <div className="page-head">
        <div>
          <small>RECOMMENDATIONS · {view.id}</small>
          <h1>What the test trials tell us</h1>
          <p>
            A combined view of trial performance, repeated behavior, and what
            may be worth trying next.
          </p>
        </div>
        <Badge tone="coral">{b.completed} trials</Badge>
      </div>
      <ErrorNote error={error} />
      <div className="recommendation-summary">
        <div className="card completion-card">
          <small>OVERALL COMPLETION</small>
          <div className="completion-value">
            <strong>{share(b.successes)}</strong>
            <span>
              {b.successes} of {b.completed} trials reached the goal
            </span>
          </div>
          <div className="breakdown-bar" aria-label="Trial outcome breakdown">
            <span className="success" style={{ width: share(b.successes) }} />
            <span className="failure" style={{ width: share(b.behavioralFailures) }} />
            <span className="error" style={{ width: share(b.infraErrors) }} />
          </div>
          <div className="breakdown-list">
            {breakdown.map(([label, count, tone]) => (
              <div key={label}>
                <Badge tone={tone}>{share(count)}</Badge>
                <span>{label}</span>
                <b>
                  {count} trial{count === 1 ? "" : "s"}
                </b>
              </div>
            ))}
          </div>
        </div>
        <div className="card trial-stats">
          <small>TRIAL PERFORMANCE</small>
          <div>
            <span>
              <b>{b.medianStepsToSuccess ?? "N/A"}</b>
              <small>Median steps to success</small>
            </span>
            <span>
              <b>{view.maxSteps}</b>
              <small>Maximum allowed steps</small>
            </span>
            <span>
              <b>{b.infraErrors}</b>
              <small>Technical error{b.infraErrors === 1 ? "" : "s"}</small>
            </span>
          </div>
          <p>
            Technical errors are reported separately and do not count as a
            product-flow failure.
          </p>
        </div>
      </div>
      <section className="section">
        <div className="section-title">
          <div>
            <small>REPEATED PATTERNS</small>
            <h2>Where people may be getting stuck</h2>
            <p>
              Recorded behavior first, followed by a clearly labeled suggestion.
            </p>
          </div>
        </div>
        <div className="recommendation-list">
          {suggested.length === 0 && (
            <div className="card no-shot">
              <b>No suggested improvements this round</b>
              <span>GhostLoop didn't find a change worth testing in these trials.</span>
            </div>
          )}
          {suggested.map(({ o, suggestion }, index) => {
            return (
              <article className="card recommendation-item" key={o.id}>
                <div className="recommendation-number">{String(index + 1).padStart(2, "0")}</div>
                <div className="recommendation-body">
                  <div className="recommendation-heading">
                    <div>
                      <small>WHAT WE SAW</small>
                      <h3>{o.text}</h3>
                      <p>{o.refs}</p>
                    </div>
                    {o.share && <Badge tone={index === 0 ? "warn" : "coral"}>{o.share}</Badge>}
                  </div>
                  <div className="suggestion-box">
                    <div>
                      <small>SUGGESTED IMPROVEMENT</small>
                      <b>{suggestion.target}</b>
                      {suggestion.blocked && <Badge tone="bad">{suggestion.risk}</Badge>}
                      <p>
                        Change “{suggestion.before}” to “{suggestion.after}”.
                      </p>
                    </div>
                    <div>
                      <small>WHY THIS MIGHT HELP · AI SUGGESTION</small>
                      <p>{suggestion.hypothesis}</p>
                    </div>
                  </div>
                  <label className="recommendation-disposition">
                    How should GhostLoop treat this pattern?
                    <select
                      value={o.disposition}
                      onChange={(event) => setDisposition(o.id, event.target.value as ObservationDisposition)}
                    >
                      {DISPOSITIONS.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </article>
            )
          })}
        </div>
      </section>
      <div className="recommendation-action card">
        <div>
          <small>READY FOR YOUR REVIEW</small>
          <h3>Choose which improvements to test</h3>
          <p>Nothing changes until you review and approve it.</p>
        </div>
        <button className="btn primary" onClick={review} disabled={view.patches.length === 0}>
          Review suggested improvements
        </button>
      </div>
    </>
  )
}

function Review({
  view,
  approve,
  decline,
  live,
  error,
}: {
  view: ExperimentView
  approve: (ids: string[]) => Promise<void>
  decline: () => Promise<void>
  live: boolean
  error?: string
}) {
  const patches = view.patches
  const [selected, setSelected] = useState<string[]>(() => {
    const first = patches.find((p) => !p.blocked)
    return first ? [first.id] : []
  })
  const [busy, setBusy] = useState(false)
  const toggle = (id: string) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    )
  const act = async (f: () => Promise<void>) => {
    setBusy(true)
    await f()
    setBusy(false)
  }
  return (
    <>
      <div className="page-head">
        <div>
          <small>TEST · {view.id}</small>
          <h1>Review suggested improvements</h1>
          <p>
            Each suggestion is tied to something that happened in the test.
            Choose one or more for the updated version.
          </p>
        </div>
        <Badge tone={view.awaitingApproval ? "warn" : view.statusTone}>
          {view.awaitingApproval ? "Waiting for your review" : view.statusLabel}
        </Badge>
      </div>
      <Progress active={2} />
      <ErrorNote error={error} />
      <div className="review-grid">
        <div>
          {patches.map((p, i) => (
            <label
              className={`card patch ${
                selected.includes(p.id) ? "selected" : ""
              } ${p.blocked ? "blocked" : ""}`}
              key={p.id}
            >
              <input
                type="checkbox"
                checked={selected.includes(p.id)}
                disabled={p.blocked || !view.awaitingApproval}
                onChange={() => toggle(p.id)}
              />
              <div className="patch-title">
                <div>
                  <small>SUGGESTION {i + 1}</small>
                  <h3>{p.target}</h3>
                </div>
                <Badge tone={p.tone}>{p.risk}</Badge>
              </div>
              <div className="diff">
                <span>
                  <small>BEFORE</small>
                  {p.before}
                </span>
                <b>→</b>
                <span>
                  <small>AFTER</small>
                  {p.after}
                </span>
              </div>
              <p>
                <b>What we saw:</b> {p.support}
              </p>
              <div className="hypothesis">
                <b>Why this might help · AI suggestion</b>
                <p>{p.hypothesis}</p>
              </div>
              <div className="artifact">
                <span>{p.correspondence === "Not linked" ? "Design file not linked" : "Figma design"}</span>
                <small>Design match</small>
                <Badge tone={p.correspondence === "Verified" ? "good" : "warn"}>
                  {p.correspondence}
                </Badge>
              </div>
            </label>
          ))}
        </div>
        <aside className="card summary">
          <small>YOUR UPDATED VERSION</small>
          <h2>
            {selected.length || "No"} change{selected.length === 1 ? "" : "s"}{" "}
            selected
          </h2>
          {selected.length ? (
            selected.map((id) => (
              <p className="summary-item" key={id}>
                ✓ {patches.find((p) => p.id === id)?.after}
              </p>
            ))
          ) : (
            <p>Choose a suggestion to create an updated version.</p>
          )}
          <hr />
          <p>
            This only creates a version to test. We will compare the results
            before deciding whether it worked better.
          </p>
          <button
            className="btn primary full"
            disabled={!selected.length || busy || !view.awaitingApproval}
            onClick={() => act(() => approve(selected))}
          >
            {busy ? "Sending…" : "Test the selected improvements"}
          </button>
          <button className="btn secondary full" disabled={busy || view.stopped} onClick={() => act(decline)}>
            Keep the current design
          </button>
        </aside>
      </div>
      <section className="section">
        <div className="section-title">
          <div>
            <small>VISUAL CHECK</small>
            <h2>Current and updated version</h2>
          </div>
        </div>
        {live ? (
          <LiveCompare view={view} selected={selected} />
        ) : (
          <div className="compare">
            <div>
              <b>Original · v1</b>
              <SubjectPreview />
            </div>
            <div>
              <b>Updated version to test</b>
              <SubjectPreview selected={selected} />
            </div>
          </div>
        )}
      </section>
    </>
  )
}

/** The current version beside a preview of the selected patches, both opened on the screen the first change is on. */
function LiveCompare({ view, selected }: { view: ExperimentView; selected: string[] }) {
  const chosen = view.patches.filter((p) => selected.includes(p.id) && p.raw)
  const preview = usePreview(view.incumbentVersionId, chosen.map((p) => p.raw!))
  if (!view.incumbentUrl) {
    return (
      <div className="no-shot">
        <b>No preview available</b>
        <span>The current version has no URL.</span>
      </div>
    )
  }
  const origin = new URL(view.incumbentUrl).origin
  const screen = chosen.find((p) => p.screen)?.screen ?? "signup"
  const at = (versionId: string) => `${origin}/v/${versionId}/${screen}`
  return (
    <div className="compare live-compare">
      <div>
        <b>Current · {view.incumbentVersionId}</b>
        <VersionPreview url={at(view.incumbentVersionId)} title="Current version" />
      </div>
      <div>
        <b>Updated version to test{chosen.length ? ` · ${chosen.length} change${chosen.length === 1 ? "" : "s"}` : ""}</b>
        {preview.kind === "ready" ? (
          <VersionPreview url={at(preview.versionId)} title="Proposed version" />
        ) : (
          <div className="no-shot preview-state">
            <b>
              {preview.kind === "loading"
                ? "Building the preview…"
                : preview.kind === "error"
                  ? "This combination can't be previewed"
                  : "Choose a suggestion to preview it"}
            </b>
            {preview.kind === "error" && <span>{preview.message}</span>}
          </div>
        )}
      </div>
    </div>
  )
}

const SAMPLE_OPTIONS: [SampleScenario, string][] = [
  ["accepted", "Accepted"],
  ["inconclusive", "Inconclusive"],
  ["rejected", "Rejected · protected requirement failed"],
  ["empty", "No valid sessions"],
]

function Results({
  view,
  live,
  scenario,
  setScenario,
  review,
  error,
}: {
  view: ExperimentView
  live: boolean
  scenario: SampleScenario
  setScenario: (s: SampleScenario) => void
  review: (status: "promoted_measured" | "discarded") => Promise<void>
  error?: string
}) {
  const [showOriginal, setShowOriginal] = useState(false)
  const [busy, setBusy] = useState(false)
  const s = view.results
  const candidate = view.candidate
  if (!s) {
    return (
      <div className="loading card">
        <Mascot small />
        <Badge tone={view.statusTone}>{view.statusLabel}</Badge>
        <h1>No comparison yet</h1>
        <p>
          {view.stopped
            ? "This test stopped before an updated version was compared."
            : "Results appear here once the updated version has been tested."}
        </p>
      </div>
    )
  }
  const decide = async (status: "promoted_measured" | "discarded") => {
    setBusy(true)
    await review(status)
    setBusy(false)
  }
  return (
    <>
      <div className="page-head">
        <div>
          <small>{live ? `COMPARISON · ${view.id}` : "SAMPLE COMPARISON"}</small>
          <h1>How behavior changed</h1>
          <p>Original test compared with the updated version.</p>
        </div>
        <Badge tone={s.tone}>{s.label}</Badge>
      </div>
      <ErrorNote error={error} />
      {!live && (
        <div className="scenario card">
          <label>
            Show sample outcome
            <select
              value={scenario}
              onChange={(e) => setScenario(e.target.value as SampleScenario)}
            >
              {SAMPLE_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <span>Illustrative data</span>
        </div>
      )}
      <div className={`decision-card card ${s.tone}`}>
        <div>
          <small>RESULT</small>
          <h2>{s.label}</h2>
          <p>{s.reason}</p>
        </div>
        <div className="decision-stats">
          <span>
            <small>Original</small>
            <b>{s.baselineRate}</b>
          </span>
          <span>
            <small>Updated</small>
            <b>{s.candidateRate}</b>
          </span>
          <span>
            <small>Change</small>
            <b>{s.improvement}</b>
          </span>
        </div>
      </div>
      <section className="behavior-comparison card">
        <div className="behavior-title">
          <div>
            <small>SIMULATED USER BEHAVIOR</small>
            <h2>What people did differently</h2>
          </div>
          <span>{s.validTrials}</span>
        </div>
        <div className="behavior-table behavior-head">
          <span>Behavior</span>
          <span>Original</span>
          <span>Updated</span>
          <span>Difference</span>
        </div>
        {s.rows.map(([label, original, updated, difference, tone]) => (
          <div className="behavior-table" key={label}>
            <b>{label}</b>
            <span>{original}</span>
            <span>{updated}</span>
            <Badge tone={tone}>{difference}</Badge>
          </div>
        ))}
      </section>
      <div className="results-bottom">
        <div className="card compact-result">
          <small>WHAT WAS TESTED</small>
          <h3>
            {candidate?.applied.length ?? 0} selected improvement
            {candidate?.applied.length === 1 ? "" : "s"}
          </h3>
          {candidate?.applied.map((change) => (
            <p key={change}>✓ {change}</p>
          ))}
          <button
            className="text-btn"
            onClick={() => setShowOriginal(!showOriginal)}
          >
            {showOriginal
              ? "Close original design"
              : "Open preserved original design →"}
          </button>
        </div>
        <div className="card compact-result">
          <small>QUALITY CHECK</small>
          <div className="quality-row">
            <span>Protected requirements</span>
            <Badge tone={s.guardrail === "Passed" ? "good" : s.guardrail === "Failed" ? "bad" : "muted"}>
              {s.guardrail}
            </Badge>
          </div>
          {s.failedGuardrails.map((g) => (
            <p className="quality-note" key={g}>
              ✕ {g}
            </p>
          ))}
          <div className="quality-row">
            <span>Technical errors</span>
            <b>{s.infraErrors}</b>
          </div>
          <div className="quality-row">
            <span>Cancelled trials</span>
            <b>{s.cancelled}</b>
          </div>
          <p className="quality-note">
            Errors and cancellations are not counted as user behavior.
          </p>
        </div>
      </div>
      {candidate && (
        <div className="final-review card">
          <div>
            <small>YOUR DECISION</small>
            {candidate.reviewStatus === "pending" ? (
              <>
                <h3>Keep the updated version?</h3>
                <p>
                  {candidate.canPromote
                    ? "The update measured better. Promoting it makes it the version future tests start from."
                    : "Only a version that measured better can be promoted. You can keep the original."}
                </p>
              </>
            ) : (
              <>
                <h3>
                  {candidate.reviewStatus === "promoted_measured"
                    ? "Updated version promoted"
                    : candidate.reviewStatus === "discarded"
                      ? "Original design kept"
                      : "Updated version kept for reference"}
                </h3>
                <p>{candidate.id}</p>
              </>
            )}
          </div>
          {candidate.reviewStatus === "pending" && (
            <div className="final-actions">
              <button className="btn secondary" disabled={busy || !candidate.canDiscard} onClick={() => decide("discarded")}>
                Keep the original
              </button>
              <button className="btn primary" disabled={busy || !candidate.canPromote} onClick={() => decide("promoted_measured")}>
                Promote this version
              </button>
            </div>
          )}
        </div>
      )}
      {showOriginal && (
        <div className="preserved-original card">
          <div>
            <small>PRESERVED ORIGINAL · {view.incumbentVersionId}</small>
            <h3>The starting design remains unchanged</h3>
            <p>
              You can return to this version at any time, regardless of the
              comparison result.
            </p>
          </div>
          {live && view.incumbentUrl ? (
            <VersionPreview url={view.incumbentUrl} title="Original version" />
          ) : (
            <SubjectPreview />
          )}
        </div>
      )}
    </>
  )
}

/** Shown while the approved update is built, checked, retested and compared. */
function CandidateLoading({ view }: { view: ExperimentView }) {
  const { progress, label } = view.update ?? { progress: 0, label: "Preparing the update" }
  return (
    <div className="loading card">
      <Mascot small />
      <Badge tone="coral">
        {label} · {progress}%
      </Badge>
      <h1>Testing your selected improvements</h1>
      <p>Running the same task again so the comparison stays fair.</p>
      <div className="bar">
        <span style={{ width: `${progress}%` }} />
      </div>
    </div>
  )
}

const TESTING_UPDATE = new Set(["patching", "validating", "candidate_running", "comparing"])

export default function App() {
  const ghost = useGhostloop()
  // After a lost connection keep showing the last live data (with a banner); sample data is only for never-connected.
  const live = ghost.status.kind === "live" || ghost.status.kind === "lost"
  const [names, setName] = useNames()
  const [view, setView] = useState<View>("landing")
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()

  // Sample mode: the original demo flow, driven by timers.
  const [progress, setProgress] = useState(0)
  const [cancelled, setCancelled] = useState(false)
  const [selectedPatches, setSelectedPatches] = useState<string[]>([])
  const [candidateProgress, setCandidateProgress] = useState(0)
  const [scenario, setScenario] = useState<SampleScenario>("accepted")
  const stopBaseline = useRef<(() => void) | null>(null)

  const list = useMemo(() => (live ? summaries(ghost.snapshot, names) : sampleSummaries), [live, ghost.snapshot, names])
  const currentId = selectedId ?? list[0]?.id
  const incumbent = live ? ghost.snapshot.experiments.find((e) => e.id === currentId)?.incumbentVersionId : undefined
  const elements = useElements(incumbent)
  const current: ExperimentView | undefined = useMemo(() => {
    if (!live) return sampleView({ progress, cancelled, selectedPatches, candidateProgress, scenario })
    return currentId ? experimentView(ghost.snapshot, currentId, names, elements) : undefined
  }, [live, ghost.snapshot, currentId, names, elements, progress, cancelled, selectedPatches, candidateProgress, scenario])

  useEffect(() => {
    if (live || view !== "results") return
    return sampleAdapter.testCandidate(setCandidateProgress)
  }, [view, live])
  useEffect(() => setError(undefined), [view, currentId])

  const run = async (kind: Parameters<typeof ghost.submit>[0], payload: unknown) => {
    const result = await ghost.submit(kind, payload)
    if (!result.ok) setError(`${result.code}: ${result.message}`)
    return result
  }

  const start = async (name: string, form: SetupForm): Promise<string | undefined> => {
    if (!live) {
      setProgress(0)
      setCancelled(false)
      setView("runs")
      stopBaseline.current = sampleAdapter.startBaseline(setProgress)
      return undefined
    }
    const parsed = parsePrototypeUrl(form.url)
    if ("error" in parsed) return parsed.error
    let manifestHash: string
    try {
      manifestHash = (await fetchManifest(parsed.versionId)).manifestHash
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
    const created = await ghost.submit("createExperiment", buildCreatePayload(form, manifestHash))
    if (!created.ok) return `${created.code}: ${created.message}`
    const { experimentId } = created.value as { experimentId: string }
    setName(experimentId, name)
    setSelectedId(experimentId)
    const started = await ghost.submit("startExperiment", { experimentId })
    if (!started.ok) return `${started.code}: ${started.message}`
    setView("runs")
    return undefined
  }

  const cancel = async () => {
    if (!live) {
      stopBaseline.current?.()
      setCancelled(true)
      return
    }
    if (current) await run("cancelExperiment", { experimentId: current.id, reason: "Stopped from the dashboard" })
  }

  const approve = async (ids: string[]) => {
    if (!live) {
      setSelectedPatches(ids)
      setCandidateProgress(0)
      setView("results")
      return
    }
    if (!current) return
    const result = await run("approvePatches", {
      experimentId: current.id,
      sourceVersionId: current.incumbentVersionId,
      round: current.round,
      patchIds: ids,
      approvedBy: "designer",
    })
    if (result.ok) setView("results")
  }

  const decline = async () => {
    if (!live) return setView("runs")
    if (!current) return
    const result = await run("cancelExperiment", { experimentId: current.id, reason: "Designer kept the current design" })
    if (result.ok) setView("runs")
  }

  const finalReview = async (status: "promoted_measured" | "discarded") => {
    if (!live || !current?.candidate) return
    await run("recordFinalReview", { experimentId: current.id, candidateId: current.candidate.id, status })
  }

  const setDisposition = (observationId: string, disposition: ObservationDisposition) => {
    if (live && current) void run("setObservationDisposition", { experimentId: current.id, observationId, disposition })
  }

  if (view === "landing") return <Landing open={() => setView(live && list.length ? "overview" : "setup")} />
  const screen: View = view !== "setup" && view !== "overview" && !current ? "setup" : view
  const sampleResultsLoading = !live && screen === "results" && candidateProgress < 100
  const liveResultsLoading = live && screen === "results" && current !== undefined && TESTING_UPDATE.has(current.state)
  return (
    <div className="app-shell">
      <Sidebar
        view={screen}
        setView={setView}
        recommendationsAvailable={current !== undefined && current.stage >= 2 && (live || progress === 100)}
        hasExperiment={live ? current !== undefined : progress > 0}
        link={ghost.status}
        retry={ghost.retry}
      />
      <main className="dashboard">
        {ghost.status.kind === "lost" && (
          <div className="alert bad">
            <b>Connection to the GhostLoop database lost.</b> Showing the last data received; actions won't go through
            until you reconnect. ({ghost.status.message}){" "}
            <button className="text-btn" onClick={ghost.retry}>
              Reconnect
            </button>
          </div>
        )}
        {live && ghost.snapshot.invalid.length > 0 && (
          <div className="alert bad">
            {ghost.snapshot.invalid.length} record{ghost.snapshot.invalid.length === 1 ? "" : "s"} could not be read and are not shown.
          </div>
        )}
        <div
          className="view-enter"
          key={sampleResultsLoading || liveResultsLoading ? "results-loading" : screen}
        >
          {screen === "overview" && (
            <Overview
              experiments={list}
              live={live}
              newTest={() => setView("setup")}
              open={(id) => {
                if (!live) {
                  setProgress(100)
                  setCancelled(false)
                } else setSelectedId(id)
                setView("runs")
              }}
            />
          )}
          {screen === "setup" && <Setup key={String(live)} start={start} live={live} />}
          {current && screen === "runs" && (
            <Runs key={current.id} view={current} cancel={cancel} review={() => setView("recommendations")} error={error} />
          )}
          {current && screen === "recommendations" && (
            <Recommendations view={current} review={() => setView("review")} setDisposition={setDisposition} error={error} />
          )}
          {current && screen === "review" && (
            <Review key={`${current.id}:${current.round}`} view={current} approve={approve} decline={decline} live={live} error={error} />
          )}
          {current && screen === "results" &&
            (sampleResultsLoading || liveResultsLoading ? (
              <CandidateLoading view={current} />
            ) : (
              <Results view={current} live={live} scenario={scenario} setScenario={setScenario} review={finalReview} error={error} />
            ))}
        </div>
      </main>
    </div>
  )
}
