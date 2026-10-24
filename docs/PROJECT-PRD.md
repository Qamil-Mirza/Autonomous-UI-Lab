# GhostLoop
## Technical Design Document — Version 2.0

**Project:** Autonomous Pre-Launch Usability Experimentation and UI Optimization

**Event:** Cal Hacks 13.0 | October 23–25, 2026

**Status:** Hackathon Implementation Specification

**Tagline:** Your first users, before your first real user.

---

# 1. Executive Summary

Early-stage startups often lack the traffic required to conduct meaningful A/B tests. As a result, usability problems can go undetected until launch, potentially costing startups their earliest customers.

**GhostLoop is a synthetic usability-testing and autonomous design-optimization platform that helps startups experiment with their product experience before launch.**

Designers provide a Figma design linked to a functional application prototype, specify tasks for users to accomplish, and define measurable performance objectives.

GhostLoop then:

1. **Simulates:** Deploys AI agents with different task-relevant behaviors to interact with the prototype.
2. **Observes:** Records actions, navigation paths, retries, failures, and task outcomes.
3. **Analyzes:** Reports recurring behavioral trends and proposes possible explanations.
4. **Improves:** Generates targeted, reversible design modifications through a combination of Anthropic Claude and Figma Agent.
5. **Retests:** Evaluates candidate designs using new simulations and independently measured task outcomes.
6. **Repeats:** Continues optimization until the specified performance goal is reached, no acceptable improvement is found, or the iteration budget is exhausted.

The distinguishing feature is the **closed-loop experimentation system**. Rather than merely critiquing a design, GhostLoop tests proposed changes and records whether they improved performance within the simulated environment.

Designers remain in control of business objectives, protected requirements, and which design changes may be applied.

**Our central promise:** Help startups identify potential usability problems and test design improvements before their first real users arrive.

**Important limitation:** Synthetic-agent performance is not equivalent to real human conversion performance. GhostLoop provides preliminary behavioral evidence and testable design hypotheses, not statistically validated predictions of human behavior.

---

# 2. Problem and Competitive Landscape

## 2.1 The Problem

Early-stage startups face several usability-testing challenges.

**Insufficient traffic for A/B testing**

Traditional production A/B testing requires enough real users to compare alternative designs meaningfully. Startups preparing to launch often have little or no traffic.

**Unidentified usability problems before launch**

An attractive interface can still contain confusing navigation, unclear pricing, hidden actions, difficult error recovery, or unnecessarily complicated onboarding.

**Cost and time required for usability testing**

Recruiting participants, conducting research sessions, interpreting observations, and implementing improvements can be expensive for small teams.

**A gap between detecting a problem and fixing it**

Design feedback does not automatically produce a better application. Teams must still decide which recommendations are valid, implement changes, and evaluate whether the modifications helped.

## 2.2 What Existing Tools Already Do

GhostLoop enters an established category. Existing products already offer several relevant capabilities.

| Tool | Existing capabilities | GhostLoop's intended differentiation |
|---|---|---|
| Maze | Human prototype testing, completion metrics, navigation paths, misclicks, heatmaps | Synthetic pre-launch experiments connected to reversible design optimization |
| Lyssna | First-click testing, prototype navigation, participant observations | Automated agent experimentation and candidate retesting |
| Attention Insight | Predicted visual attention and saliency heatmaps | Task-based navigation and actual application state transitions |
| Uxia | AI-generated usability feedback and synthetic testing | Explicit design constraints, structured mutations, independent evaluation, rollback |
| Other synthetic-user tools | Simulated interactions and qualitative usability reports | Designer-governed recursive optimization with measurable acceptance criteria |

GhostLoop should not claim to have invented AI usability testing.

Instead, our differentiator is the integration of:

- Trace-grounded behavioral observations.
- Explicit designer-defined objectives.
- Targeted, constrained design modifications.
- Executable candidate versions.
- Independent retesting.
- Non-destructive design history and selective approval.

**Positioning:** GhostLoop closes the loop between observing user behavior, proposing a design change, and testing whether that change helped.

---

# 3. Product Goals and Design Principles

## 3.1 Primary Goals

The hackathon MVP should demonstrate:

1. A Figma design linked to an executable React prototype.
2. A designer-defined task, success objective, and set of protected requirements.
3. AI agents interacting with the functional prototype.
4. Real interaction traces and environment-verified outcomes.
5. Neutral, trace-grounded behavioral reports.
6. A structured feedback handoff to the design-improvement system.
7. At least one targeted design modification.
8. A runnable candidate that can be compared with the original.
9. Independent retesting and objective acceptance or rejection.
10. A designer interface for inspecting evidence and reviewing changes.

## 3.2 Secondary Goals

- Multiple agent scenarios with varying familiarity and persistence.
- Live synthetic-user swarm visualization.
- Outcome-colored interaction and terminal-event maps.
- Multiple design candidates.
- Partial approval and cherry-picking.
- Manual and bounded automatic optimization modes.
- Editable Figma versions corresponding to tested designs.
- Real-time experiment streaming through SpacetimeDB.

## 3.3 Non-Goals for the Hackathon

We are not attempting to:

- Replicate actual human cognition or demographics.
- Produce real eye-tracking or brain-activation measurements.
- Predict production conversion rates with statistical confidence.
- Support arbitrary Figma applications without an execution adapter.
- Give AI unrestricted permission to modify business logic.
- Replace real human usability testing.

## 3.4 Design Principles

**Observation before interpretation**

The system reports what agents actually did before suggesting why they behaved that way.

**Designer intent is authoritative**

Business requirements such as mandatory signup, consent, and pricing rules must not be interpreted as defects without context.

**Every revision is reversible**

Original designs are preserved. Changes create new candidate versions.

**Separate proposing from evaluating**

The system that suggests a change cannot declare that the change succeeded.

**Constrained autonomy**

Automatic design modifications must be permitted, auditable, and bounded.

**Comparable experiments**

Design versions must be tested using consistent task definitions, scenario allocations, and evaluation rules.

---

# 4. Core User Experience

## Step 1 — Connect a Design and Define the Task

A designer selects a Figma frame and associated functional prototype.

They specify a task, such as:

**"Create a new workspace on the Free plan and invite one teammate."**

They also define what counts as success.

Example success conditions:

- A new account must be created.
- A workspace must exist.
- The Free plan must be selected.
- An invitation must be successfully sent.
- No duplicate workspace should be created.

The designer specifies constraints:

- Account creation is mandatory.
- Pricing rules must not be modified.
- Invite validation must remain functional.
- Existing authentication requirements must be preserved.

Example experiment configuration:

| Parameter | Value |
|---|---|
| Primary task | Create a Free workspace and invite a teammate |
| Completion target | 85% of valid simulated sessions |
| Runs per version | 12 |
| Maximum actions per agent | 8 |
| Maximum optimization iterations | 3 |
| Maximum candidates per iteration | 2 |
| Optimization mode | Manual Review |
| Protected requirements | Signup, pricing, invite validation |

These values are illustrative defaults and may change after benchmarking.

## Step 2 — Configure Synthetic Users

Instead of assigning arbitrary personalities, GhostLoop configures agents along task-relevant behavioral dimensions.

| Dimension | Example configurations |
|---|---|
| Product familiarity | First-time visitor / returning user |
| Domain familiarity | Familiar with SaaS workspaces / unfamiliar |
| Technical fluency | Self-directed / requires clearer guidance |
| Persistence | Stops early / retries multiple times |
| Error exposure | Happy path / invalid email / incorrect plan |
| Primary concern | Speed / privacy / cost |

For example, an error-recovery scenario could begin with an invalid teammate email address.

The agent must observe the error, determine what happened, correct the input, and try again.

A low-persistence configuration may stop after one unsuccessful retry. A high-persistence configuration may attempt several corrections.

These configurations are **controlled experimental conditions**, not scientifically validated representations of different human demographics.

## Step 3 — Run Simulations

Agents interact with the functional application using Playwright.

Each agent:

1. Opens the application in an isolated browser session.
2. Receives a task and scenario configuration.
3. Observes the current screenshot and available UI controls.
4. Uses a vision-language model to select an action.
5. Executes the action.
6. Observes the resulting application state.
7. Continues until task completion or a stopping condition.

GhostLoop records the complete trace of each session.

## Step 4 — Observe and Report Behavioral Trends

The dashboard displays:

- Successful task completions.
- Explicit agent stops.
- Step-budget exhaustion.
- Blocked workflows.
- Infrastructure failures.
- Navigation paths.
- Repeated actions.
- Screen revisits.
- Error recovery attempts.

The default report emphasizes neutral observations.

Example:

"Among 12 valid simulated sessions, 9 reached account creation, 7 selected the Free plan, 5 sent an invitation, and 4 completed the full task."

Another example:

"Five of twelve sessions returned to the plan-selection screen after making an initial selection."

GhostLoop may then generate a separately labeled hypothesis:

"The Free and Pro plans may not be sufficiently differentiated."

However, the designer can mark this pattern as:

- Investigate.
- Intentional.
- Not relevant.

A finding marked intentional should not repeatedly trigger the same design recommendation.

## Step 5 — Generate and Review Design Changes

Claude analyzes the observed trends and proposes targeted modifications.

Examples:

- Clarify the Free-plan CTA.
- Improve plan comparison labels.
- Make recovery instructions more visible.
- Add supporting information to the invitation screen.

The designer receives a change proposal showing:

- What will change.
- Which traces support the recommendation.
- Which business requirements will remain protected.
- Whether the change requires approval.
- A preview of the candidate design.

**Partial approval is supported.**

The designer may approve one proposed change while rejecting others.

The approved subset creates a new candidate version rather than overwriting the original design.

## Step 6 — Retest and Compare

GhostLoop runs fresh simulations on the candidate version.

The system compares:

- Simulated task success.
- Median successful action count.
- Repeated errors.
- Backtracking.
- Per-scenario outcomes.
- Functional and business constraints.

Candidates are accepted only when they satisfy the defined requirements and improvement criteria.

A designer may still retain an inconclusive candidate for aesthetic reasons, but that decision is recorded separately from a measured improvement.

---

# 5. The Wow Factor: Live Agent Swarm

GhostLoop's defining visual feature is a live or replayable visualization of synthetic users navigating an application.

Imagine watching multiple AI users attempting to create a workspace.

Colored cursors move across the prototype as agents select buttons, navigate between screens, encounter errors, and attempt recovery.

Designers can select an individual agent to inspect its complete interaction history.

## 5.1 Outcome-Based Visualization

| Color | Outcome |
|---|---|
| Green | Verified task completion |
| Orange | Explicit agent stop or abandonment |
| Red | Step limit exceeded or unrecoverable product-flow block |
| Gray | Model, browser, or infrastructure error |

A terminal-event map shows where each session ended.

For example, multiple orange markers near a plan-selection screen may reveal a concentration of explicit stops at that point.

These visualizations are based on actual recorded actions.

They are **not gaze heatmaps**, and the system should not imply that agents experienced human hesitation or emotion.

## 5.2 Interaction Heatmaps

GhostLoop may additionally aggregate recorded clicks by screen.

Important requirements:

- Click coordinates must correspond to actual recorded actions.
- Comparisons must use the correct design version.
- Different screen layouts must not share raw pixel coordinates without a transformation.
- Terminal-event markers must distinguish stop reasons.
- Reports should include denominators for each observed pattern.

For example:

"Six of nine sessions that visited this screen ended here."

## 5.3 Replay

Designers can replay an individual agent's navigation history.

Each trace includes:

- Screenshot or application state.
- Selected element.
- Action performed.
- Resulting screen.
- Error or validation feedback.
- Final task outcome.

This makes findings inspectable instead of relying solely on AI-generated explanations.

---

# 6. Technical Architecture

## 6.1 End-to-End Flow

**Designer + Figma**

↓

**Versioned React Prototype**

↓

**Simulation Orchestrator**

↓

**Bitdeer Vision-Language Model**

↓

**Playwright Interaction Executor**

↓

**SpacetimeDB Trace Storage**

↓

**Independent Metrics Evaluator**

↓

**Claude Failure Analysis**

↓

**Structured Design Feedback Packet**

↓

**Mutation Policy and Approval Gate**

↓

**Design Mutation Engine + Figma Agent**

↓

**New Executable Design Candidate**

↓

**Retest and Compare**

↓

**Accept / Reject / Revise**

↓

**Designer Review or Next Optimization Iteration**

The dashboard subscribes to SpacetimeDB throughout the experiment.

## 6.2 Sponsor Technologies

| Sponsor | Responsibility |
|---|---|
| Figma / Figma Agent | Source design context, editable design variants, visual review |
| Bitdeer AI Model Studio | Vision-language inference for simulated agent decisions |
| Anthropic Claude | Observation analysis, hypotheses, design mutation planning |
| SpacetimeDB | Experiment state, interaction traces, version metadata, live subscriptions |

Supporting technologies:

- React + Vite for the prototype and dashboard.
- TypeScript for shared contracts.
- Playwright for browser execution.
- Cursor / Claude Code for development.

## 6.3 Important Architecture Boundary

A Figma frame is not automatically a functional application.

For the MVP, the **React prototype is the executable source of truth**.

The application uses a versioned design manifest, such as `design.json`, that controls supported properties including:

- Text labels.
- Styling tokens.
- Element ordering.
- Visibility of optional elements.
- Limited layout properties.

GhostLoop applies structured mutations to this manifest.

The corresponding Figma design revision is created through the available Figma Agent/MCP workflow.

The system must not assume that editing Figma automatically updates React.

We must verify that the displayed Figma revision corresponds to the actual tested React candidate.

---

# 7. Synthetic User Engine

## 7.1 Agent Inputs

Each agent receives:

- Current screenshot.
- Task description.
- Scenario configuration.
- Available clickable or editable elements.
- Relevant previous actions.
- Remaining action budget.

The agent must not receive the hidden success-condition implementation or the correct navigation path.

## 7.2 Supported Actions

Initial action types:

- Click.
- Type.
- Select.
- Stop.

Actions refer to known element IDs rather than arbitrary model-generated JavaScript.

## 7.3 Execution Loop

1. Initialize an isolated Playwright browser context.
2. Open the correct design version.
3. Capture the screenshot and available controls.
4. Request an action from Bitdeer.
5. Validate that the action is permitted.
6. Execute it through Playwright.
7. Record the action and resulting state.
8. Check task completion independently.
9. Continue or terminate.

## 7.4 Termination Reasons

Each session must record one explicit outcome:

- `goal`: The task was completed successfully.
- `agent_stop`: The agent explicitly stopped.
- `step_limit`: Maximum actions reached.
- `flow_blocked`: The workflow cannot proceed.
- `model_error`: Inference failed.
- `browser_error`: Browser execution failed.
- `user_cancelled`: The experiment was cancelled.

Infrastructure errors must be reported separately from behavioral failures.

## 7.5 Measurement Caveats

Do not infer human hesitation from model API latency.

Do not treat an agent reaching its action budget as voluntary abandonment.

Do not describe prompted personas as representative demographic populations.

Do not count the model's self-reported success as proof of task completion.

---

# 8. Shared Data Contracts

All teams should use versioned interfaces in a shared `packages/contracts` directory.

## 8.1 Experiment Protocol

Defines:

- Experiment ID.
- Design version ID.
- Task.
- Hidden environment-verified goal.
- Allowed paths.
- Business intent constraints.
- Protected elements.
- Target completion rate.
- Minimum acceptable improvement.
- Number of simulations.
- Maximum actions.
- Maximum iterations.
- Maximum inference budget.
- Manual or automatic mode.
- Scenario configurations.

## 8.2 Agent Run Result

Contains:

- Run ID.
- Design version ID.
- Scenario ID.
- Ordered action events.
- Actual task-success result.
- Step count.
- End reason.
- Terminal screen.
- Last observed pointer position.
- Screenshot references.
- Whether the run is valid for behavioral evaluation.

## 8.3 Observation Trend

Contains:

- Observation ID.
- Design version ID.
- Neutral behavioral statement.
- Numerator and denominator.
- Supporting trace references.
- Related screens.
- Optional interpretation.
- Designer disposition.

## 8.4 Mutation Patch

Contains:

- Patch ID.
- Source version.
- Target element ID.
- Mutation operation.
- Proposed value.
- Supporting observation IDs.
- Rationale.
- Risk classification.

Initially supported mutation operations:

- `set_label`
- `set_style_token`
- `set_order`
- `set_visibility`

## 8.5 Candidate Design

Contains:

- Candidate ID.
- Parent design version.
- Selected patch IDs.
- Runnable prototype URL.
- Figma frame reference, when available.
- Review and evaluation status.

## 8.6 Evaluation

Contains:

- Version and experiment protocol IDs.
- Successful simulation count.
- Valid behavioral-run count.
- Invalid infrastructure-run count.
- Median actions to success.
- Outcome distribution.
- Scenario-specific results.
- Guardrail results.
- Acceptance/rejection decision.
- Stopping reason.

These contracts allow teams to develop against mock data without waiting for every subsystem to be available.

---

# 9. Evidence-to-Figma Feedback Contract

One major challenge is ensuring the design agent correctly interprets experimental observations.

A free-form instruction such as "Improve the onboarding UX" is not sufficiently constrained.

Instead, GhostLoop generates a structured **Design Feedback Packet**.

## 9.1 Feedback Packet Contents

| Field | Purpose |
|---|---|
| Design version and Figma frame reference | Identifies the exact design being modified |
| Task contract | Defines what successful user behavior means |
| Observations | Neutral, measured behavior and supporting counts |
| Trace evidence | Specific agent runs and interaction events |
| Hypotheses | Possible explanations, explicitly marked as unconfirmed |
| Candidate patches | Specific proposed changes |
| Protected constraints | Business rules that must remain intact |
| Review policy | Whether changes require human approval |

## 9.2 Example

**Task**

Create a workspace on the Free plan and invite one teammate.

**Observation**

Five of twelve simulated sessions returned to the plan-selection screen at least once.

**Hypothesis**

Free and Pro options may be insufficiently differentiated.

**Proposed patch**

Change the Free-plan button label from "Continue" to "Continue with Free plan."

**Protected requirements**

Account creation, pricing rules, and invitation validation must remain unchanged.

**Review policy**

Manual approval required.

## 9.3 How the Change Is Implemented

Preferred MVP workflow:

1. Claude produces a structured feedback packet.
2. The mutation engine validates the requested patch.
3. A deterministic patcher creates a new React design manifest.
4. The application is built and smoke-tested.
5. Figma Agent generates a matching editable design variant where supported.
6. The designer reviews the change and its evidence.

If the Figma and React versions cannot be verified as corresponding, the dashboard must report the discrepancy rather than implying they are synchronized.

---

# 10. Mutation Permission Policy

Not all design changes should be eligible for autonomous execution.

We classify patches by risk.

## 10.1 Low-Risk Changes

Examples:

- Spacing within approved design tokens.
- Alignment adjustments.
- Nonsemantic styling changes.
- Limited visual prominence adjustments.

These may run automatically if functional and accessibility checks pass.

## 10.2 Review-Required Changes

Examples:

- Meaningful button-label changes.
- CTA hierarchy.
- Ordering of onboarding steps.
- Visibility of optional controls.
- Changes to important explanatory text.

These require explicit designer approval.

## 10.3 Blocked Changes

Examples:

- Removing mandatory signup.
- Changing prices or fees.
- Modifying authentication logic.
- Removing required consent.
- Disabling form validation.
- Removing protected fields.
- Altering the hidden success checker.

Blocked operations must fail deterministically.

An LLM may provide a risk assessment, but it cannot override the operation allowlist or downgrade prohibited changes.

If classification is uncertain, require manual review.

---

# 11. Manual Review and Auto-Optimize Modes

## 11.1 Manual Review

The designer reviews and approves mutations before implementation.

Workflow:

Simulate → Observe → Analyze → Propose → Review → Apply → Retest.

The designer may accept, reject, or select only part of a proposed change set.

## 11.2 Auto-Optimize

The system automatically applies only permitted low-risk changes.

Workflow:

Simulate → Observe → Analyze → Propose → Validate → Apply → Retest → Compare → Repeat.

Auto mode remains subject to:

- Iteration budget.
- Inference budget.
- Mutation allowlist.
- Business constraints.
- Functional tests.
- Accessibility guardrails.
- Stopping conditions.

No modification is automatically deployed to production.

## 11.3 Partial Acceptance

Suppose the system proposes:

1. Change the CTA label.
2. Increase button prominence.
3. Reorder onboarding steps.

The designer may approve only the first two.

GhostLoop creates a new candidate from the original design with those two patches.

The new candidate must be tested independently.

Results from the original full candidate cannot be reused as evidence that the partial candidate performs equally well.

---

# 12. Recursive Optimization Controller

**This is the core engineering contribution of GhostLoop.**

The controller manages the full cycle from observed behavior to tested design improvements.

## 12.1 Controller States

The system uses an explicit state machine:

Created → Baseline Running → Observing → Diagnosing → Proposing → Awaiting Approval (if required) → Patching → Validating → Candidate Running → Comparing → Accepted / Rejected → Next Round / Stopped.

Each state transition is recorded.

## 12.2 One Optimization Round

**Step 1 — Evaluate the incumbent**

Run simulations on the current accepted design.

**Step 2 — Generate observations**

Aggregate task outcomes and recurring behavioral patterns.

**Step 3 — Diagnose**

Claude generates hypotheses based on the evidence.

**Step 4 — Propose mutations**

Produce narrowly targeted candidate patches.

**Step 5 — Enforce permission policy**

Reject blocked patches and request approval for review-required changes.

**Step 6 — Create candidate designs**

Each candidate is a new immutable version.

**Step 7 — Validate**

Run build tests, functional smoke tests, protected-requirement checks, and relevant accessibility checks.

**Step 8 — Retest**

Run fresh simulations on each valid candidate.

**Step 9 — Compare**

An independent evaluator calculates task outcomes and performance metrics.

**Step 10 — Promote or reject**

The controller retains the candidate only when it meets the acceptance rule.

## 12.3 Sequential vs. Parallel Optimization

Our initial implementation should use **sequential optimization rounds**.

Within a round, we may generate multiple candidates and evaluate them in parallel.

For example:

Design A

→ Candidate B: Clarify Free-plan label.

→ Candidate C: Increase Free-plan prominence.

B and C may be evaluated independently.

The controller selects at most one candidate as the new incumbent.

The next optimization round starts from that accepted design.

We should not apply multiple unvalidated mutations to the same design simultaneously.

If the designer wants to combine improvements from B and C, GhostLoop creates a new composed candidate and retests it.

For the first working prototype, one candidate per round is sufficient.

---

# 13. Acceptance Criteria and Stopping Conditions

## 13.1 Primary Objective

The initial objective is valid simulated task-completion rate:

**Successful valid behavioral sessions / Total valid completed behavioral sessions.**

Secondary metrics include:

- Median actions to success.
- Backtracking.
- Repeated unsuccessful interactions.
- Validation errors.
- Scenario-specific results.

## 13.2 Candidate Acceptance Rule

A candidate is eligible only if it passes all hard constraints.

Then the evaluator compares its results with the current accepted design.

An example acceptance policy:

1. Reject candidates that violate protected requirements.
2. Prefer candidates whose simulated completion rate improves by at least a predefined margin.
3. Reject unacceptable regressions in other metrics.
4. Mark small or ambiguous differences as inconclusive.
5. Preserve the current incumbent unless a qualifying improvement is demonstrated.

For example, a minimum improvement of 10 percentage points could be used as a hackathon heuristic.

This threshold is **not a statistical significance test**.

With twelve sessions per design, results can be noisy. The interface must report exact counts and avoid claiming proven improvements in real human behavior.

## 13.3 Stopping Conditions

GhostLoop must distinguish between successful completion and stopping because of limitations.

| Stopping reason | Definition |
|---|---|
| TARGET_MET | The defined simulated-performance objective was reached |
| ITERATION_BUDGET | Maximum redesign rounds reached |
| COST_BUDGET | Inference spending limit reached |
| TIME_BUDGET | Execution-time limit reached |
| NO_VALID_PATCH | No proposed mutation satisfies the allowed constraints |
| NO_MEASURED_IMPROVEMENT | Candidates did not meet the improvement requirement |
| INCONCLUSIVE | Results are too uncertain under the chosen rule |
| USER_STOP | The designer manually stopped optimization |
| INTEGRATION_FAILURE | The system could not produce or validate a runnable candidate |

The final report must show:

- Best accepted design.
- All attempted candidates.
- Performance measurements.
- Rejected mutations.
- Remaining problems.
- Explicit stopping reason.

## 13.4 Preventing Reward Hacking

An autonomous optimizer may find shortcuts that improve its metric without improving the product.

For example, removing authentication might reduce signup steps while violating business requirements.

To prevent this:

- Protect mandatory fields and logic.
- Use an independent success checker.
- Preserve original versions.
- Enforce an operation allowlist.
- Keep evaluation scenarios separate from development scenarios when possible.
- Use fresh simulation sessions for retesting.
- Reject candidates that violate protected functionality.

The system must not optimize by changing the definition of success.

---

# 14. SpacetimeDB Data Architecture

SpacetimeDB stores experiment state, trace metadata, candidate history, and evaluation results.

Suggested tables:

| Table | Purpose |
|---|---|
| experiments | Task definitions, budgets, objectives, experiment status |
| design_versions | Immutable design history and artifact references |
| agent_runs | Individual simulation sessions and outcomes |
| agent_actions | Ordered action and navigation events |
| observations | Neutral behavioral trends |
| hypotheses | Tentative explanations generated from evidence |
| patches | Proposed design mutations and approval states |
| candidates | Alternative versions and selected patch combinations |
| evaluations | Independently measured performance results |

The runtime flow is:

Playwright worker → SpacetimeDB event write → frontend subscription → updated agent visualization.

Every action receives an ordered sequence number, allowing the dashboard to replay events consistently.

Screenshots should be stored as files or objects, with stable references retained in SpacetimeDB.

Model API calls and browser execution remain in external workers.

---

# 15. Four Independent Development Workstreams

Each developer should be able to work independently using shared contracts and mock fixtures.

## Group A — Frontend and Experiment Dashboard

**Technologies:** React, Vite/Next.js, TypeScript, SpacetimeDB subscriptions.

**Responsibilities:**

- Experiment configuration interface.
- Live agent swarm.
- Trace replay.
- Outcome-filtered terminal maps.
- Neutral observation reports.
- Version A/B comparisons.
- Candidate review.
- Patch cherry-picking.
- Manual/auto-mode controls.
- Explicit stopping-reason display.

**Independent deliverable:**

A complete dashboard that works with mock simulation results and prerecorded traces.

## Group B — Synthetic User Simulation Engine

**Technologies:** Bitdeer AI Model Studio, Playwright, TypeScript.

**Responsibilities:**

- Managed vision-language inference integration.
- Screenshot and UI-control extraction.
- Structured action selection.
- Browser action execution.
- Scenario configuration.
- Persistence and retry policies.
- Agent session lifecycle.
- Batch simulation.
- Ordered interaction traces.
- Verifiable task outcomes.

**Independent deliverable:**

Given a prototype URL, task, and scenario configuration, run a model-driven agent and return a complete interaction trace.

Use a standalone test website until the final prototype is ready.

## Group C — Figma and Executable Prototype

**Technologies:** Figma Agent/MCP, React, TypeScript.

**Responsibilities:**

- Create a realistic workspace-onboarding demo.
- Implement the same application as a functioning React prototype.
- Establish stable element IDs.
- Create a canonical design manifest.
- Implement deterministic design patches.
- Create immutable candidate versions.
- Validate patched applications.
- Demonstrate editable Figma design revisions.
- Maintain mapping between tested React versions and Figma variants.

**Independent deliverable:**

Given a hardcoded structured patch, create a validated, runnable Design B and a corresponding editable Figma review variant.

## Group D — Backend and Recursive Optimization

**Technologies:** Anthropic Claude, SpacetimeDB, TypeScript.

**Responsibilities:**

- Experiment state management.
- SpacetimeDB tables and event handling.
- Metric calculation.
- Neutral observation aggregation.
- Claude-based diagnosis.
- Structured Design Feedback Packets.
- Mutation planning.
- Deterministic permission enforcement.
- Recursive optimization controller.
- Candidate evaluation.
- Acceptance and rollback.
- Stopping conditions.

**Independent deliverable:**

A controller that runs a complete optimization cycle using mocked simulation data and a mocked design-mutation adapter.

## Integration Milestones

**Merge 0 — Shared Contracts**

Agree on schemas, stable element IDs, and mock fixtures.

**Merge 1 — Real Agent Execution**

Connect Groups B and C.

At least one AI agent performs multiple real actions on the executable onboarding prototype.

**Merge 2 — Closed-Loop Optimization**

Connect Groups B, C, and D.

Baseline simulations produce observations, Claude proposes a patch, the patch produces a candidate, and the candidate is independently retested.

**Merge 3 — Real-Time Dashboard**

Connect Group A and SpacetimeDB.

The dashboard displays real action traces, results, and version comparisons.

**Merge 4 — Designer-Facing Figma Review**

Demonstrate an editable Figma candidate tied to the tested design version, with approval and selective acceptance.

---

# 16. Demo Application and Judging Narrative

## 16.1 Why the Demo Must Be Nontrivial

A simple signup button is not a compelling usability-testing scenario.

Most designers can correctly implement a straightforward signup screen.

Instead, GhostLoop should demonstrate a realistic multi-step onboarding task that contains legitimate ambiguity and opportunities for recovery.

## 16.2 Proposed Demo

A startup is onboarding teams to a workspace-management application.

**User task:**

"Create a new workspace on the Free plan and invite one collaborator without starting a paid trial."

The flow involves:

1. Account creation.
2. Workspace creation.
3. Plan selection.
4. Collaborator invitation.
5. Confirmation.

Potential issues include:

- Ambiguous Free/Pro plan labels.
- Unclear onboarding sequence.
- Recovering from an invalid email address.
- Locating relevant help text.
- Understanding whether a credit card is required.

These challenges allow agents with different task scenarios to make meaningful choices.

If an agent clicks Signup because account creation is required, the system should not automatically treat that as a usability defect.

## 16.3 Three-Minute Demo

**0:00–0:25 — Introduce the problem**

Startups lack sufficient traffic for meaningful production A/B testing.

**0:25–0:45 — Configure the experiment**

Show the Figma-linked prototype, success goal, and protected requirements.

**0:45–1:15 — Launch the synthetic users**

Show real agent traces through the live swarm visualization.

**1:15–1:45 — Reveal a behavioral trend**

For example, multiple agents revisit plan selection before proceeding.

Show the actual traces and a tentative explanation.

**1:45–2:20 — Generate a design revision**

Approve a narrowly scoped patch and display an editable Figma candidate.

**2:20–2:45 — Retest**

Compare the two designs using measured simulated outcomes.

**2:45–3:00 — Close**

"GhostLoop closes the loop from simulated behavior to reversible, measurable design experiments."

A replay of previously recorded real agent traces should be available if live inference or Figma operations are slow.

Recorded demonstrations must be labeled accurately.

---

# 17. Hackathon Milestones and Priorities

## Gate 0 — Architecture and Sponsor Validation

- [ ] Freeze shared data contracts.
- [ ] Verify Bitdeer vision-language inference.
- [ ] Test an actual Figma Agent editing workflow.
- [ ] Verify SpacetimeDB write-and-subscribe functionality.
- [ ] Prepare mock fixtures for all teams.

## Gate 1 — Real Synthetic Task Execution

- [ ] Functional multi-screen onboarding prototype.
- [ ] Model-driven agent completes at least two genuine browser actions.
- [ ] Recovery scenario can attempt to repair an invalid input.
- [ ] Complete ordered trace with a verifiable outcome.

## Gate 2 — Closed-Loop Optimization

- [ ] Baseline simulations.
- [ ] Trace-grounded observations.
- [ ] Structured Design Feedback Packet.
- [ ] Targeted mutation.
- [ ] Validated Design B.
- [ ] Independent retest.
- [ ] Accept/reject decision.
- [ ] Preserved design history.

## Gate 3 — Polished Product Experience

- [ ] Live/replayed agent swarm.
- [ ] Outcome-colored terminal-event map.
- [ ] Trace inspector.
- [ ] Candidate comparison.
- [ ] Partial approval controls.
- [ ] Editable Figma revision.
- [ ] Reliable demo fallback.

## Feature Cut Order

If time becomes limited, remove features in this order:

1. Arbitrary Figma imports.
2. Large and complex persona combinations.
3. Advanced heatmap effects.
4. Multiple concurrent design candidates.
5. Fully autonomous multi-round optimization.

**Do not cut:** Genuine agent interactions, environment-verified success, trace evidence, an executable targeted patch, independent retesting, and reversible designer review.

---

# 18. Technical Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Figma write-back is unavailable | Verify early; fall back to a supported designer-triggered editable-variant workflow |
| Figma and React versions diverge | Share patch IDs and version references; expose discrepancies |
| Agents behave unrealistically | Use controlled scenarios instead of arbitrary personality descriptions |
| Claude misinterprets intended behavior | Show neutral observations first and enforce designer intent |
| Mutation optimizes the wrong objective | Independent checker and protected requirements |
| Abandonment is misclassified | Explicit termination reasons |
| Evaluation results are noisy | Fixed protocols, fresh sessions, raw counts, inconclusive outcomes |
| Multiple patches interfere | Independently test composed candidates |
| Inference becomes slow or expensive | Concurrency limits, action budgets, cost caps, recorded-run fallback |
| Infrastructure integration fails | Mock adapters and isolated workstream testing |

All testing should use fictional or synthetic account data. No production credentials or real payment information are required.

---

# 19. Sponsor Technologies and Target Prizes

## Sponsor Stack

**Figma / Figma Agent**

Design source, editable variants, and visual review.

**Bitdeer AI Model Studio**

Managed inference for multimodal synthetic agents.

**Anthropic Claude**

Evidence analysis, failure hypotheses, and design-mutation planning.

**SpacetimeDB**

Real-time experiment state, interaction traces, and dashboard synchronization.

## Primary Prize Targets

- Cal Hacks — Most Creative Project.
- Cal Hacks — Most Technically Advanced Hack.
- Figma — Most Creative Use Case of Figma Agent.
- Figma — Best Use Case of Figma Agent.
- Bitdeer AI — Best Use of Bitdeer AI Model Studio.

## Additional Targets

- Figma — Best Design.
- Other applicable Figma design categories.
- SpacetimeDB sponsor award, subject to confirming eligibility.

Exact track names and eligibility should be checked against the official event submission rules.

---

# 20. Resolution of Team Feedback

This revision incorporates all eleven comments from the team.

| Comment | Resolution |
|---|---|
| Existing AI UX tools and metrics | Added competitive landscape and clarified our differentiation |
| More nuanced personas | Added familiarity, technical fluency, persistence, and controlled error-recovery scenarios |
| Heatmaps for success versus abandonment | Added outcome-colored terminal-event maps with explicit stop reasons |
| Report trends instead of imposing interpretations | Observations and hypotheses are now distinct |
| Who implements design revisions? | Added deterministic patch engine and Figma Agent handoff |
| Manual acceptance and partial changes | Added Manual Review, Auto-Optimize, cherry-picking, and immutable versions |
| Definition of no acceptable improvement | Added objective acceptance rules and explicit stop conditions |
| Structured feedback for Figma | Added Design Feedback Packet |
| Which changes may run automatically? | Added low-risk, review-required, and blocked mutation categories |
| Sequential versus concurrent iterations | Sequential promotion with optional parallel candidate evaluation |
| Signup demo too simple | Replaced with realistic multi-step workspace onboarding |

---

# 21. Open Decisions

| Question | Current recommendation |
|---|---|
| Product name | GhostLoop |
| Demo task | Free-workspace onboarding plus teammate invitation |
| Executable prototype | React + Vite |
| Canonical design representation | Versioned JSON manifest |
| Number of initial scenarios | Four controlled configurations |
| Initial candidates per round | One |
| Maximum iteration budget | Three |
| Default review mode | Manual |
| Automatic edit permissions | Low-risk presentation changes only |
| Figma synchronization | Verified editable-variant workflow; no assumed full bidirectional sync |
| Simulation engine | Bitdeer VLM + Playwright |
| Experiment data | SpacetimeDB |
| Recursive planner | Anthropic Claude |

---

# 22. Final Acceptance Test

GhostLoop's MVP is successful if a designer can:

1. Select a supported Figma-linked prototype.
2. Define a meaningful task and protected requirements.
3. Launch synthetic agents that perform real interactions.
4. Observe genuine navigation traces and outcomes.
5. Distinguish measured behavior from speculative explanations.
6. Review evidence-backed proposed modifications.
7. Generate a non-destructive design candidate.
8. Retest the candidate against comparable scenarios.
9. See whether the candidate improved the defined objective.
10. Accept, reject, or selectively preserve the changes.

The system must preserve the original design and report its stopping reason accurately.

## Final Product Vision

**GhostLoop — Your first users, before your first real user.**

GhostLoop enables startups to run controlled experiments with synthetic users, inspect the resulting behavioral evidence, and iteratively improve their application designs before launch.

We are not replacing real users.

**We are helping startups discover and fix the usability problems that could cost them their first users.**
