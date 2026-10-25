# Judge-based goal verification

**Status:** approved · **Date:** 2026-10-25 · **Area:** simulator (B), optimizer evaluation (D), dashboard (A)

## Why

A designer types a task into Setup, but today that text does not decide success. Each trial is scored by C's fixed
checker (`checkGoal`: account created, exactly one workspace, Free plan, a valid invite sent, no paid trial), and the
simulator ends the trial the moment those five pass. A designer who wrote "…then go to the dashboard" got 100% success
even though the prototype has no dashboard: the extra step was never attempted, and nothing could fail it.

The designer wants the task they write to be what is judged. A trial should be scored on whether it really reached the
goal as written, decided from evidence by a stronger model, while protected rules stay absolute.

## What the designer gets

1. They write the goal in plain language in Setup (for example "invite a teammate, then go to the dashboard").
2. Simulated users work toward it and narrate each action ("clicking 'Go to dashboard' because the task says to finish
   there").
3. When a trial ends, a judge model reviews the evidence and decides: goal reached or not, with a short explanation that
   cites what it saw.
4. The dashboard shows each trial's verdict and the judge's explanation, and success rates and comparisons use the
   verdicts.

## Decisions (made with the designer)

- **The judge verifies outcomes, not effort or claims.** If the task can't be completed in the prototype, trials fail.
  Example: "go to the dashboard" fails, because there is no dashboard page, even if the agent clicked "Go to dashboard".
  The agent's narration is a claim to check against evidence, never proof.
- **Protected rules are a veto.** Breaking a protected rule always fails the trial, whatever the judge says. Everything
  outside the protected rules is decided by the judge against the task as written.
- **The judge takes precedence over C's checker for everything else.** The checker's facts (account, workspaces, plan,
  invite) become evidence the judge reads, not requirements. A task like "sign up and create a workspace" can pass
  without an invite.
- **When the judge can't tell, the trial fails.** An uncertain verdict counts as a failure, not as an excluded run.
- **The goal is judged on the final state.** What counts is where the trial ended up, not whether the goal was met at
  some moment along the way. A user who completes the task and then undoes it (for example creates a second
  workspace) does not get credit. The action history explains how the user got there; it doesn't earn the pass.
- **The judge is a stronger model than the simulated users.** The designer asked for "Claude or another smarter model".
  *My call:* Claude Opus 5.5 (`claude-opus-5-5`), the model that already writes the suggestions, through the existing
  `ANTHROPIC_API_KEY` in the repo-root `.env`.
- *My call:* the simulator runs the judge at the end of each trial, where the screenshots and the full action log
  already are, so the run it hands D already carries the verdict and the contracts don't change shape.

## How it works

### Trial lifecycle (simulator, B)

- A trial no longer stops when the fixed checks pass. It runs until the simulated user stops (says it is done, or gives
  up) or hits the action limit.
- Every action carries a one-line reason: what the user is doing and why. The reason becomes required in the model's
  action format (today it is optional).
- When the trial ends, the simulator gathers the evidence and asks the judge for a verdict, then sets the run's outcome.

### Evidence the judge sees

- The task text exactly as the designer wrote it.
- Every action in order: type, target element and its visible label, typed value (passwords redacted), the user's
  reason, the result (ok, validation error, no effect…), and the screen before and after.
- The screens visited, and the final screen.
- The final screenshot plus a small number of key screenshots (for example the screen before each screen change),
  bounded so the request stays small.
- C's checker facts for the run (account, workspaces, plan, invites, paid trial), read once when the trial ends and
  labeled as the final application state. The protected-rule veto is also checked after each action, so a violation
  ends the trial at once.
- The scenario's persona description and input data (for example the teammate address it meant to invite), as context
  for what the user was trying to do. *(My call.)*
- The judge never sees the hidden success criteria of the old checker as requirements, only as facts.

### The judge's verdict

- `reached: true | false | "uncertain"`, a short explanation citing specific steps or screens, and the evidence it
  relied on.
- Uncertain is treated as not reached.

### Scoring a trial

Only behavioral endings are judged: the user stopped (`agent_stop`), ran out of actions (`step_limit`), or reached a
page with no usable controls (`flow_blocked`). Infrastructure errors (`model_error`, `browser_error`) and cancellations
keep their outcomes and stay excluded from the rate, as today; a judge verdict never turns them into `goal`. *(My call.)*

In order:

1. A protected rule was broken → the trial fails (`flow_blocked`), records which rule, and the dashboard names it. The
   trial ends as soon as the violation appears, since nothing after it can rescue it. *(My call.)*
2. The judge says reached → `goal`.
3. The judge says not reached or uncertain → the outcome reflects how the trial ended: the user stopped (`agent_stop`)
   or ran out of actions (`step_limit`).
4. The judge call itself fails (provider error after retries) → `model_error`, an infrastructure error excluded from the
   rate like today. This is different from the judge being uncertain.

`goalVerified` is true only in case 2. `goalEvidence` stores the judge's verdict and explanation. The existing contract
fields stay; their meaning is now "verified by the judge".

*My call on contracts:* add optional fields rather than packing everything into the `goalEvidence` string. D owns
`packages/contracts`, and optional fields keep every existing fixture and consumer valid:
- on `AgentRunResult`: `judge` (`reached: true | false | "uncertain"`, `explanation`, `model`, `instructionVersion`) and
  `protectedViolation` (the rule's name), so the dashboard can show "Judge unsure" apart from "not reached" and name a
  broken rule;
- on `ExperimentProtocol`: `vetoRules` (default `["no_paid_trial"]`);
- on `BatchResult` / `BatchRecord`: the judge model and instruction version, so a comparison can confirm both batches
  were judged alike.

### Protected rules that veto

The rules a simulated user can actually break at runtime. For this prototype: **no paid trial started** (from C's
checker, `no_paid_trial`). Prices, signup fields, consent and validation are enforced by application code and
patches can't change them, so they need no runtime veto. The veto list is configurable per protocol so another flow can
add its own.

### Fairness across A and B

The baseline and the candidate are judged by the same model, the same judge instructions and the same evidence rules.
The judge model ID and an instruction version are recorded with each batch so a comparison never mixes judges.

### Cost and limits

- One judge call per trial. With Claude Opus 5.5 and a handful of screenshots, a few cents per call: a 25-trial test
  (50 judgments) adds roughly $1–2.
- Judge calls count toward the experiment's cost budget, priced from their real token usage, separately from the
  simulator's Bitdeer call cap. A trial that finished is always judged: budget limits stop new trials from starting,
  never the judgment of one that already ran. Rate limits are handled like the simulator's: wait and retry. *(My call.)*

### Dashboard (A)

- Each trial shows the verdict ("Goal verified", "Goal not reached", "Judge unsure") and the judge's explanation.
  A protected-rule failure names the rule.
- Setup says plainly that success is judged against the task as written, and lists the protected rules that always fail
  a trial.
- The optimizer's observations and Claude's suggestions keep working from the same runs; nothing there depends on the
  old checker's five conditions.

## Goals

- The task text defines success; an impossible task scores 0%.
- Protected rules stay absolute.
- Verdicts are explainable and inspectable per trial.
- A and B are judged identically.

## Non-goals

- Judging free-form tasks that need information the evidence doesn't contain (for example "the user felt confident").
- Replacing C's checker; it stays as the source of application-state facts and the protected-rule veto.
- Letting the simulated users see the judge or its criteria.

## Anti-goals (would make this a failure even if it works)

- A trial passes because the agent said it was done.
- A protected rule is broken and the trial still counts as a success.
- Baseline and candidate judged by different models or instructions.
- Verdicts without an explanation a designer can check.

## Out of scope

- The practice path (no prototype, `checkPracticeGoal`) keeps its old check. *(My call.)*

## Left to the builder

- Exactly which screenshots count as key, and the cap.
- The judge prompt wording and output schema, within the decisions above.
- Where the judge's instruction version lives and how it's recorded on the batch.
- How existing recorded runs (judged by the old checker) are labeled in the dashboard.
