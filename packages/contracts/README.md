# `@ghostloop/contracts`

These are the shared types, runtime validators (zod 3), adapter interfaces, designer command shapes and synthetic
fixtures for GhostLoop. D owns this package. A (dashboard), B (simulation) and C (candidates) code against it.

## Setup

```sh
nvm use && npm ci
npm run check -w @ghostloop/contracts   # tsc + vitest
```

The package uses Node 22, TypeScript in strict ESM mode, and extensionless relative imports. Every top-level record
has `schemaVersion: "1.0.0"`. IDs carry a prefix (`exp_ ver_ scn_ run_ obs_ hyp_ pat_ cand_ val_ eval_ appr_
batch_ proto_`), and the schemas reject IDs with the wrong prefix. Timestamps are ISO-8601 UTC strings. Screenshots
are stored as references (`{ uri, width, height }`), never as image data.

## Imports

| Entry point | Use |
| --- | --- |
| `@ghostloop/contracts` | All public schemas, types, enums and adapter interfaces |
| `@ghostloop/contracts/hidden` | `HiddenGoalSpec`. **Only the trusted goal checker may import this.** It must never reach the agent, the dashboard or a prompt |
| `@ghostloop/contracts/fixtures` | `loadFixture`, `FIXTURE_SCHEMAS`. See [`fixtures/README.md`](fixtures/README.md) |

```ts
import { BatchResult, type SimulationAdapter } from "@ghostloop/contracts";
const result = BatchResult.parse(json); // validate at every boundary
```

## Adapter signatures

```ts
// B implements
interface SimulationAdapter {
  runBatch(req: BatchRequest, onEvent: (e: AgentActionEvent) => void, signal: AbortSignal): Promise<BatchResult>;
}

// C implements
interface CandidateAdapter {
  createCandidate(sourceVersionId: VersionId, approvedPatches: MutationPatch[]): Promise<CandidateDesign>;
  validateCandidate(candidateId: CandidateId): Promise<ValidationResult>;
  getManifest(versionId: VersionId): Promise<DesignManifest>;
}

// D implements (Claude); returns unvalidated JSON that D's policy then validates
interface AnalysisAdapter {
  proposeFeedback(input: AnalysisInput): Promise<{ raw: unknown; usage: UsageReport }>;
}
```

When an adapter rejects or throws, D treats it as an integration failure. D does not read error message text.

## Designer commands (A → D)

Payload schemas are exported from `commands.ts`. Every command returns
`CommandResult<T> = { ok: true; value: T } | { ok: false; code: CommandErrorCode; message: string }`.

| Command | Payload |
| --- | --- |
| `CreateExperiment` | `{ protocol: ExperimentProtocolDraft, baseVersionUrl: string (url), baseManifestHash: string }` |
| `StartExperiment` | `{ experimentId }` |
| `CancelExperiment` | `{ experimentId, reason? }` |
| `SetObservationDisposition` | `{ experimentId, observationId, disposition: "unreviewed" \| "confirmed" \| "intentional" \| "not_relevant" }` |
| `ApprovePatches` | `{ experimentId, sourceVersionId, round, patchIds[], approvedBy }` |
| `RecordFinalReview` | `{ experimentId, candidateId, status: "promoted_measured" \| "retained_aesthetic" \| "discarded", note? }` |

Error codes: `NOT_FOUND`, `INVALID_STATE`, `STALE_SOURCE_VERSION`, `ALREADY_APPROVED`, `UNKNOWN_PATCH`,
`PATCH_BLOCKED`, `VALIDATION_FAILED`. Only `RecordFinalReview { status: "promoted_measured" }` on an `accepted`
candidate changes the incumbent version.

## Integration checklist

**A (dashboard)**
- [ ] Validate command payloads with the exported schemas before you send them. Handle every `CommandErrorCode`.
- [ ] Render `ObservationTrend`, `DesignFeedbackPacket` (patches are blocked, low-risk, or need review), `Evaluation` and `StoppingRecord` from the fixtures before live data exists.
- [ ] Show the `provenance: "synthetic-fixture"` label when you display fixture data.
- [ ] Never import `@ghostloop/contracts/hidden`.

**B (simulation)**
- [ ] Implement `SimulationAdapter.runBatch`. Stream `AgentActionEvent`s through `onEvent` with 0-based contiguous `seq` per run. `(runId, seq)` is the dedupe key.
- [ ] Give the agent `PublicAgentInput` only. It is a strict schema: it contains no hidden goal and no outcome.
- [ ] Set `outcome`, `goalVerified` (only from the trusted checker), `behaviorallyValid` and `stepCount`. Steps count every event except `stop` actions. `AgentRunResult.parse` enforces the outcome and validity rules.
- [ ] Respect `signal`. Report cancelled runs as `user_cancelled` and environment failures as `model_error` or `browser_error`.
- [ ] Check your output against `fixtures/batch.*.json`.

**C (candidates)**
- [ ] Implement `CandidateAdapter`. `getManifest` returns a `DesignManifest` with stable `elementId`s, `protected`, `categories` and `supportedOps`.
- [ ] Apply only the `MutationPatch`es you receive (`set_label`, `set_style_token`, `set_order`, `set_visibility`).
- [ ] `validateCandidate` returns `ValidationCheck`s. Any failed `guardrail` check makes D reject the candidate.
- [ ] Replace the placeholder element IDs in the fixtures. Send D the final IDs so D can update the contracts and fixtures first.

## Schema-change process

1. Raise the change with D. D edits `src/*.ts` **and** the affected fixtures in the same PR. `npm run check -w @ghostloop/contracts` must pass.
2. A breaking change bumps `SCHEMA_VERSION`.
3. Teammates rebase onto `main` and update their adapters. Do not fork or patch contract types locally.
