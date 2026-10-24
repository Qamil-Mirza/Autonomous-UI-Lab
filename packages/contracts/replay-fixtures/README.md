# Recorded replay fixtures for A and D

These are real recorded browser sessions, kept separate from `../fixtures/`, whose
catalog is explicitly synthetic. No new live model calls were used to export them.

| Fixture | Provenance | Result | Meaning |
|---|---|---|---|
| `recorded-2026-10-24/success/run.json` | live-bitdeer / Qwen/Qwen3.8-27B | goal, 10 actions | Trusted state checker verified baseline onboarding. |
| `recorded-2026-10-24/non-success/run.json` | live-bitdeer / Qwen/Qwen3.8-27B | step_limit, 1 action | Deliberately capped one-action smoke test. This is a genuine incomplete run, **not evidence of a usability failure**. |

Each directory contains the shared `AgentRunResult`, identical ordered events as
JSONL, PNG screenshots and a provenance manifest with SHA-256 image checksums.
Screenshot URIs are relative to the fixture directory. A should resolve each URI
against that directory's served URL, for example `new URL(ref.uri, fixtureBaseUrl)`.
D can parse `run.json` with `AgentRunResult` and deduplicate events by `(runId, seq)`.
Typed data and credentials are fictional test inputs. No API keys are exported.

These historical runs predate the latest richer trace fields; missing optional
fields are intentionally not invented. For old events, the preceding run screenshot
provides the before image. The original recorded outcome, timestamps, IDs, actions
and checker evidence are preserved. The original machine's absolute screenshot paths
are replaced with local filenames so the package is portable.

Fresh baseline and label-patched website integration was also checked with scripted
browser sessions and D's actual `InMemoryStore` reference implementation. That
check is separate from these live fixtures and is not a deployed SpacetimeDB test.
Fresh live baseline/candidate sessions remain pending explicit approval for sending
multiple prototype screenshots to Bitdeer and consuming credits.
