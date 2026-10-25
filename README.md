# Ghost Loop

Your first users, before your first real user.

GhostLoop is a pre-launch usability lab. AI agents try to complete a task in your product, GhostLoop finds where they get stuck, proposes a small design change, and retests it. A designer approves every change, and every tested version gets a matching, editable Figma frame.

Built at Cal Hacks 13.0.

---

## Why

A/B tests need traffic, and pre-launch products have none. So usability problems ship with the product, and the first real users are the ones who find them. Existing tools can flag issues, but someone still has to decide what to change, build it, and check whether it helped. GhostLoop closes that loop.

## How the loop works
1. **Simulate.** AI agents use the real app in a browser (Playwright). At each step, a vision model on Bitdeer sees a screenshot and the page's actual controls, picks an action, and the agent performs it on the live page. Agents get only the task, never the hidden success criteria.
2. **Check.** A trusted goal checker reads the run's saved state, not the screen or the agent's own claims. An agent that says "done" gets no credit unless the state proves it.
3. **Diagnose and propose.** Claude reviews the batch and proposes small, typed design patches (`set_label`, `set_style_token`, `set_order`, `set_visibility`). Protected elements such as prices, consent, and validation can never be patched.
4. **Approve.** The designer reviews each proposed patch in the dashboard and approves only the ones they want.
5. **Retest.** The patch engine builds a new design version (never editing the original), the agents run again, and a fixed rule decides: accepted, rejected, or inconclusive.
6. **Back to Figma.** Each candidate version is written into Figma as an editable frame and read back to verify every change matched.

## The demo task

The test app is Matrix Coor, a fictional CRM with a five-screen onboarding flow: sign up → create a workspace → choose a plan → invite a teammate → confirm. The goal: create an account and one workspace on the Free plan, invite one teammate, and never start a paid trial. Most B2B SaaS products onboard this way, so the findings generalize.

## Repository Map
| Path | What it is |
|---|---|
| `apps/dashboard` | Experiment dashboard: set up tests, watch live agent traces, review and approve patches. Built in Figma Make, then wired to the backend. |
| `apps/prototype` | The Matrix Coor onboarding app agents test. React + Vite, driven by versioned design manifests. |
| `workers/simulator` | Synthetic-user runs: Playwright browser + Bitdeer vision model. |
| `workers/optimizer` | The experiment loop: diagnose, propose, wait for approval, retest, decide. Uses Claude for analysis and judging. |
| `packages/contracts` | Shared types, validators (zod), adapter interfaces, and fixtures. |
| `packages/design-engine` | Manifest schema, deterministic patch engine, manifest diff, Figma read-back checks. |
| `packages/prototype-adapter` | Run-isolated app state, simulated invite service, trusted goal checker, candidate builder. |
| `packages/importer` | Imports Figma Make code exports into a sandbox so agents can test them. |
| `packages/db`, `spacetimedb/` | SpacetimeDB module and client for live experiment state. |
| `designs/` | Design versions (`versions/`) and Figma mappings (`figma/`). Only the baseline is committed. |
| `docs/` | PRD, Figma sponsor brief, merge plan, and the reusable Figma variant workflow. |

Most packages have their own README with full details.

## Quick start

Requires **Node 22+** (`nvm use`).

### Try it without API keys

```sh
npm install
npm run check                               # typecheck and tests across every workspace
npm run dev -w @ghostloop/prototype         # onboarding app: http://localhost:5173/v/ver_baseline/signup
npm run demo:mock                           # one full optimizer round on mock adapters (labeled MOCK MODE)
```

Mock output is synthetic and labeled as such. It is not evidence of AI performance.

### Run the full product

Install the SpacetimeDB CLI once:

```sh
curl -sSf https://install.spacetimedb.com | sh
```

Put keys in a repo-root `.env` (never commit it):

```dotenv
ANTHROPIC_API_KEY=...
BITDEER_API_KEY=...
BITDEER_BASE_URL=https://api-inference.bitdeer.ai/v1
BITDEER_MODEL=...
```

Then:

```sh
./demo.sh                 # SpacetimeDB, worker (real adapters + Figma Make imports), dashboard, prototype
./demo.sh --e2e 6         # also drive the import flow through the dashboard (spends model credits)
./demo.sh --no-prototype  # imports only
```

Needs Node 22+, the SpacetimeDB CLI, Docker (for imported apps), and the keys above.
Services already running are reused; Ctrl+C stops only what the script started. Logs: `.ghostloop/demo-logs/`.
See [`packages/importer/README.md`](packages/importer/README.md) for the import workflow.

Real runs cost money: every agent step is a Bitdeer call, and each proposing and judging step is a Claude call. Start with a few trials.

## How we used Figma

We took two routes through Figma on purpose, based on what each piece needed:

| | Test app (`apps/prototype`) | Dashboard (`apps/dashboard`) |
|---|---|---|
| **Needed** | Precision: layer names become element IDs | Speed and polish |
| **Figma path** | Figma Design + Figma agent → Figma MCP → Claude Code | Figma Make → code export → Claude Code |

- Every Figma layer with a dotted name (for example `plan.free.cta`) is rendered with that exact `data-testid`, so agents click it, patches target it, and the goal checker trusts it.
- Claude Code read the designs through Figma's MCP server and, in plan mode, caught a layer-naming mistake before writing any code.
- Tested candidates are written back into Figma and verified element by element. See [`docs/figma-variant-workflow.md`](docs/figma-variant-workflow.md) for the reusable recipe.

## Guardrails

- **Protected requirements:** prices, consent, validation, and signup fields cannot be patched.
- **Independent evaluation:** success is judged from saved state, never from the agent's own report.
- **Human approval:** no patch reaches a candidate without designer approval.
- **Honest results:** a retest can end as inconclusive, and the dashboard says so.

## Team

- **Hanna** — dashboard, live traces, designer review
- **Jaclyn** — synthetic-user simulation (Bitdeer + Playwright)
- **Emma** — onboarding prototype, patch engine, Figma variants
- **Qamil** — experiment storage, evaluation, optimization loop

## Built with

TypeScript, React, Vite, Node.js, Playwright, Zod, Vitest, SpacetimeDB, Bitdeer AI, Anthropic Claude, Claude Code, Figma Design, Figma agent, Figma MCP, Figma Make.
