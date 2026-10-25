import { useEffect, useRef, useState } from "react"
import {
  experiment,
  observations,
  patches,
  runs,
  scenarios,
} from "./sampleData"
import type { Run } from "./sampleData"
import { sampleAdapter } from "./mockService"

type View = "landing" | "overview" | "setup" | "runs" | "recommendations" | "review" | "results"
type Scenario = keyof typeof scenarios

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

function Sidebar({
  view,
  setView,
  recommendationsAvailable,
}: {
  view: View
  setView: (v: View) => void
  recommendationsAvailable: boolean
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
          onClick={() => setView(recommendationsAvailable ? "runs" : "setup")}
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
      <div className="sidebar-foot">
        <span className="pulse-dot" />
        Demo · Sample data
      </div>
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

function SessionReplay({ run }: { run: Run }) {
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

function Overview({
  setView,
  openRecent,
}: {
  setView: (v: View) => void
  openRecent: () => void
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
          <button className="btn primary" onClick={() => setView("setup")}>
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
          <button className="table-row" onClick={openRecent}>
            <span>
              <b>Free plan onboarding</b>
              <small>exp_ghostloop_01</small>
            </span>
            <Badge tone="good">First test complete</Badge>
            <span>Today, 10:42</span>
            <span>View →</span>
          </button>
        </div>
      </section>
    </>
  )
}

function Setup({ start }: { start: (name: string) => void }) {
  const [name, setName] = useState(experiment.name)
  const [url, setUrl] = useState(experiment.prototypeUrl)
  const [error, setError] = useState("")
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !/^https?:\/\//.test(url))
      return setError("Add a test name and a valid website or prototype URL.")
    start(name)
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
            <input value={url} onChange={(e) => setUrl(e.target.value)} />
          </label>
        </div>
        <label>
          Task description
          <textarea rows={4} defaultValue={experiment.task} />
        </label>
        <div className="field-row">
          <label>
            Number of test trials
            <input type="number" defaultValue="12" min="1" />
          </label>
          <label>
            Maximum steps per trial
            <input type="number" defaultValue="25" min="1" />
          </label>
        </div>
        <details>
          <summary>
            Advanced settings <span>Completion, margins, and limits</span>
          </summary>
          <div className="field-row">
            <label>
              Completion target
              <input defaultValue="Workspace created + invite sent" />
            </label>
            <label>
              Minimum improvement
              <input defaultValue="10 percentage points" />
            </label>
          </div>
          <label>
            Time / cost limit
            <input defaultValue="15 min / $20" />
          </label>
        </details>
        <label className="check">
          <input type="checkbox" defaultChecked />
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
          <span>Test trials use labeled sample data in this demo.</span>
          <button className="btn primary">Start the first test</button>
        </div>
      </form>
    </div>
  )
}

function Runs({
  progress,
  cancelled,
  cancel,
  review,
}: {
  progress: number
  cancelled: boolean
  cancel: () => void
  review: () => void
}) {
  const [selected, setSelected] = useState(runs[0])
  return (
    <>
      <div className="page-head">
        <div>
          <small>TEST · {experiment.id}</small>
          <h1>{experiment.name}</h1>
          <p>
            {cancelled
              ? "Stopped by user"
              : progress < 100
                ? "Your first test is running with sample trials…"
                : "First test complete · findings are ready"}
          </p>
        </div>
        <div>
          <Badge tone={cancelled ? "bad" : progress === 100 ? "good" : "coral"}>
            {cancelled
              ? "Cancelled"
              : progress === 100
                ? "First test complete"
                : `Running · ${progress}%`}
          </Badge>
          {!cancelled && progress < 100 && (
            <button className="btn danger ghost" onClick={cancel}>
              Stop test
            </button>
          )}
        </div>
      </div>
      <Progress active={progress === 100 ? 1 : 0} />
      {cancelled && (
        <div className="alert bad">
          <b>Test stopped.</b> Completed sample trials are still available. No
          updated version was created.
        </div>
      )}
      <div className="metrics">
        {[
          ["12", "Completed trials"],
          ["6", "Verified successes"],
          ["5", "Behavioral failures"],
          ["1", "Infrastructure error"],
          [cancelled ? "1" : "0", "Cancellations"],
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
            <Badge>12 total</Badge>
          </div>
          {runs.map((r) => (
            <button
              key={r.id}
              className={selected.id === r.id ? "selected" : ""}
              onClick={() => setSelected(r)}
            >
              <span>
                <b>{r.label}</b>
                <small>{r.id}</small>
              </span>
              <Badge tone={r.tone}>{r.outcome}</Badge>
            </button>
          ))}
        </div>
        <div className="run-detail card">
          <div className="card-head">
            <div>
              <b>{selected.label}</b>
              <small>{selected.id}</small>
            </div>
            <Badge tone={selected.tone}>{selected.outcome}</Badge>
          </div>
          {selected.screenshot ? (
            <SessionReplay key={selected.id} run={selected} />
          ) : (
            <div className="no-shot">
              <b>No screenshot available</b>
              <span>This trial ended before a replay was captured.</span>
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
            <b>Final outcome</b>
            <span>{selected.outcome}</span>
          </div>
        </div>
      </div>
      {progress === 100 && !cancelled && (
        <div className="next-step card">
          <div>
            <small>NEXT STEP</small>
            <h3>See the patterns across all 12 trials</h3>
            <p>
              Recommendations combines the trial results and suggests focused
              improvements.
            </p>
          </div>
          <button className="btn primary" onClick={review}>
            View recommendations
          </button>
        </div>
      )}
    </>
  )
}

function Recommendations({ review }: { review: () => void }) {
  const [disp, setDisp] = useState<Record<string, string>>({})
  const breakdown = [
    ["Goal completed", "6", "50%", "good"],
    ["Could not finish the journey", "5", "41.7%", "warn"],
    ["Technical error", "1", "8.3%", "muted"],
  ]
  return (
    <>
      <div className="page-head">
        <div>
          <small>RECOMMENDATIONS · {experiment.id}</small>
          <h1>What the test trials tell us</h1>
          <p>
            A combined view of trial performance, repeated behavior, and what
            may be worth trying next.
          </p>
        </div>
        <Badge tone="coral">12 sample trials</Badge>
      </div>
      <div className="recommendation-summary">
        <div className="card completion-card">
          <small>OVERALL COMPLETION</small>
          <div className="completion-value">
            <strong>50%</strong>
            <span>6 of 12 trials reached the goal</span>
          </div>
          <div className="breakdown-bar" aria-label="Trial outcome breakdown">
            <span className="success" style={{ width: "50%" }} />
            <span className="failure" style={{ width: "41.7%" }} />
            <span className="error" style={{ width: "8.3%" }} />
          </div>
          <div className="breakdown-list">
            {breakdown.map(([label, count, rate, tone]) => (
              <div key={label}>
                <Badge tone={tone}>{rate}</Badge>
                <span>{label}</span>
                <b>{count} trials</b>
              </div>
            ))}
          </div>
        </div>
        <div className="card trial-stats">
          <small>TRIAL PERFORMANCE</small>
          <div>
            <span>
              <b>14</b>
              <small>Median steps to success</small>
            </span>
            <span>
              <b>25</b>
              <small>Maximum allowed steps</small>
            </span>
            <span>
              <b>1</b>
              <small>Technical error</small>
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
          {observations.map((o, index) => {
            const suggestion = patches[index]
            return (
              <article className="card recommendation-item" key={o.id}>
                <div className="recommendation-number">0{index + 1}</div>
                <div className="recommendation-body">
                  <div className="recommendation-heading">
                    <div>
                      <small>WHAT WE SAW</small>
                      <h3>{o.text}</h3>
                      <p>{o.refs}</p>
                    </div>
                    <Badge tone={index === 0 ? "warn" : "coral"}>
                      {index === 0 ? "42% of trials" : "33% of trials"}
                    </Badge>
                  </div>
                  <div className="suggestion-box">
                    <div>
                      <small>SUGGESTED IMPROVEMENT</small>
                      <b>{suggestion.target}</b>
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
                      value={disp[o.id] || "Worth testing"}
                      onChange={(event) =>
                        setDisp({ ...disp, [o.id]: event.target.value })
                      }
                    >
                      <option>Worth testing</option>
                      <option>Expected behavior</option>
                      <option>Not relevant</option>
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
        <button className="btn primary" onClick={review}>
          Review suggested improvements
        </button>
      </div>
    </>
  )
}

function Review({
  approve,
  decline,
}: {
  approve: (ids: string[]) => void
  decline: () => void
}) {
  const [selected, setSelected] = useState<string[]>([patches[0].id])
  const toggle = (id: string) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    )
  return (
    <>
      <div className="page-head">
        <div>
          <small>TEST · {experiment.id}</small>
          <h1>Review suggested improvements</h1>
          <p>
            Each suggestion is tied to something that happened in the test.
            Choose one or more for the updated version.
          </p>
        </div>
        <Badge tone="warn">Waiting for your review</Badge>
      </div>
      <Progress active={2} />
      <div className="review-grid">
        <div>
          {patches.map((p) => (
            <label
              className={`card patch ${
                selected.includes(p.id) ? "selected" : ""
              }`}
              key={p.id}
            >
              <input
                type="checkbox"
                checked={selected.includes(p.id)}
                onChange={() => toggle(p.id)}
              />
              <div className="patch-title">
                <div>
                  <small>SUGGESTION {patches.indexOf(p) + 1}</small>
                  <h3>{p.target}</h3>
                </div>
                <Badge tone={p.risk.startsWith("Low") ? "good" : "warn"}>
                  {p.risk}
                </Badge>
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
                <span>Design file not linked</span>
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
            disabled={!selected.length}
            onClick={() => approve(selected)}
          >
            Test the selected improvements
          </button>
          <button className="btn secondary full" onClick={decline}>
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
      </section>
    </>
  )
}

function Results({ selectedPatches }: { selectedPatches: string[] }) {
  const [scenario, setScenario] = useState<Scenario>("accepted")
  const [showOriginal, setShowOriginal] = useState(false)
  const s = scenarios[scenario]
  const applied = selectedPatches
    .map((id) => patches.find((p) => p.id === id)?.after)
    .filter(Boolean)
  const behaviorRows =
    scenario === "accepted"
      ? [
          ["Reached the goal", "6 of 12", "8 of 12", "2 more", "good"],
          [
            "Went back to compare plans",
            "5 trials",
            "2 trials",
            "3 fewer",
            "good",
          ],
          [
            "Opened the paid-trial dialog",
            "4 trials",
            "1 trial",
            "3 fewer",
            "good",
          ],
          ["Steps needed when successful", "14", "11", "3 fewer", "good"],
        ]
      : scenario === "inconclusive"
        ? [
            ["Reached the goal", "6 of 12", "7 of 12", "1 more", "warn"],
            [
              "Went back to compare plans",
              "5 trials",
              "4 trials",
              "1 fewer",
              "warn",
            ],
            [
              "Opened the paid-trial dialog",
              "4 trials",
              "3 trials",
              "1 fewer",
              "warn",
            ],
            ["Steps needed when successful", "14", "13", "1 fewer", "warn"],
          ]
        : scenario === "rejected"
          ? [
              ["Reached the goal", "6 of 12", "9 of 12", "3 more", "good"],
              [
                "Started a paid trial by mistake",
                "0 trials",
                "3 trials",
                "Unsafe",
                "bad",
              ],
              [
                "Went back to compare plans",
                "5 trials",
                "2 trials",
                "3 fewer",
                "good",
              ],
              ["Steps needed when successful", "14", "10", "4 fewer", "good"],
            ]
          : [
              ["Reached the goal", "6 of 12", "N/A", "No data", "muted"],
              [
                "Went back to compare plans",
                "5 trials",
                "N/A",
                "No data",
                "muted",
              ],
              [
                "Opened the paid-trial dialog",
                "4 trials",
                "N/A",
                "No data",
                "muted",
              ],
              ["Steps needed when successful", "14", "N/A", "No data", "muted"],
            ]
  return (
    <>
      <div className="page-head">
        <div>
          <small>SAMPLE COMPARISON</small>
          <h1>How behavior changed</h1>
          <p>Original test compared with the updated version.</p>
        </div>
        <Badge tone={s.tone}>{s.label}</Badge>
      </div>
      <div className="scenario card">
        <label>
          Show sample outcome
          <select
            value={scenario}
            onChange={(e) => setScenario(e.target.value as Scenario)}
          >
            <option value="accepted">Accepted</option>
            <option value="inconclusive">Inconclusive</option>
            <option value="rejected">
              Rejected · protected requirement failed
            </option>
            <option value="empty">No valid sessions</option>
          </select>
        </label>
        <span>Illustrative data</span>
      </div>
      <div className={`decision-card card ${s.tone}`}>
        <div>
          <small>RESULT</small>
          <h2>{s.label}</h2>
          <p>{s.reason}</p>
        </div>
        <div className="decision-stats">
          <span>
            <small>Original</small>
            <b>50%</b>
          </span>
          <span>
            <small>Updated</small>
            <b>{s.rate}</b>
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
          <span>12 valid trials per version</span>
        </div>
        <div className="behavior-table behavior-head">
          <span>Behavior</span>
          <span>Original</span>
          <span>Updated</span>
          <span>Difference</span>
        </div>
        {behaviorRows.map(([label, original, updated, difference, tone]) => (
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
            {applied.length} selected improvement
            {applied.length === 1 ? "" : "s"}
          </h3>
          {applied.map((change) => (
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
            <Badge tone={s.guardrail === "Passed" ? "good" : "bad"}>
              {s.guardrail}
            </Badge>
          </div>
          <div className="quality-row">
            <span>Technical errors</span>
            <b>{scenario === "empty" ? "9" : "1"}</b>
          </div>
          <div className="quality-row">
            <span>Cancelled trials</span>
            <b>{scenario === "empty" ? "3" : "0"}</b>
          </div>
          <p className="quality-note">
            Errors and cancellations are not counted as user behavior.
          </p>
        </div>
      </div>
      {showOriginal && (
        <div className="preserved-original card">
          <div>
            <small>PRESERVED ORIGINAL · ver_original_01</small>
            <h3>The starting design remains unchanged</h3>
            <p>
              You can return to this version at any time, regardless of the
              comparison result.
            </p>
          </div>
          <SubjectPreview />
        </div>
      )}
    </>
  )
}

export default function App() {
  const [view, setView] = useState<View>("landing")
  const [progress, setProgress] = useState(0)
  const [cancelled, setCancelled] = useState(false)
  const [hasCompletedTest, setHasCompletedTest] = useState(false)
  const [selectedPatches, setSelectedPatches] = useState<string[]>([])
  const [candidateProgress, setCandidateProgress] = useState(0)
  const stopBaseline = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (view !== "results") return
    return sampleAdapter.testCandidate(setCandidateProgress)
  }, [view])
  const start = () => {
    setProgress(0)
    setCancelled(false)
    setHasCompletedTest(false)
    setView("runs")
    stopBaseline.current = sampleAdapter.startBaseline((value) => {
      setProgress(value)
      if (value === 100) setHasCompletedTest(true)
    })
  }
  const approve = (ids: string[]) => {
    setSelectedPatches(ids)
    setCandidateProgress(0)
    setView("results")
  }
  if (view === "landing") return <Landing open={() => setView("setup")} />
  return (
    <div className="app-shell">
      <Sidebar
        view={view}
        setView={setView}
        recommendationsAvailable={hasCompletedTest}
      />
      <main className="dashboard">
        <div
          className="view-enter"
          key={
            view === "results" && candidateProgress < 100
              ? "results-loading"
              : view
          }
        >
          {view === "overview" && (
            <Overview
              setView={setView}
              openRecent={() => {
                setProgress(100)
                setCancelled(false)
                setHasCompletedTest(true)
                setView("runs")
              }}
            />
          )}
          {view === "setup" && <Setup start={start} />}
          {view === "runs" && (
            <Runs
              progress={progress}
              cancelled={cancelled}
              cancel={() => {
                stopBaseline.current?.()
                setCancelled(true)
                setHasCompletedTest(false)
              }}
              review={() => setView("recommendations")}
            />
          )}
          {view === "recommendations" && (
            <Recommendations review={() => setView("review")} />
          )}
          {view === "review" && (
            <Review approve={approve} decline={() => setView("runs")} />
          )}
          {view === "results" && candidateProgress < 100 ? (
            <div className="loading card">
              <Mascot small />
              <Badge tone="coral">
                Testing the update · {candidateProgress}%
              </Badge>
              <h1>Testing your selected improvements</h1>
              <p>Running the same task again so the comparison stays fair.</p>
              <div className="bar">
                <span style={{ width: `${candidateProgress}%` }} />
              </div>
            </div>
          ) : (
            view === "results" && <Results selectedPatches={selectedPatches} />
          )}
        </div>
      </main>
    </div>
  )
}
