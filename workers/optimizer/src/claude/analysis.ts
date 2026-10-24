import Anthropic from "@anthropic-ai/sdk";
import type { AnalysisAdapter, AnalysisInput, UsageReport } from "@ghostloop/contracts";
import { priceUsd } from "./pricing";
import { PROPOSAL_JSON_SCHEMA, SYSTEM_PROMPT, renderAnalysisInput } from "./prompt";

export const CLAUDE_ANALYSIS_MODEL = "claude-opus-5-5";
const MAX_TOKENS = 16000;
const TIMEOUT_MS = 180_000;

/** A response the model gave but that cannot be used: asking again would not help, so the round fails. */
export class ClaudeAnalysisError extends Error {
  constructor(readonly kind: "refusal" | "truncated", message: string) {
    super(message);
    this.name = "ClaudeAnalysisError";
  }
}

type Response = Anthropic.Beta.BetaMessage;

function costOf(res: Response): number {
  const iterations = res.usage.iterations ?? [];
  const billed = iterations.filter((it) => it.type === "message" || it.type === "fallback_message");
  if (billed.length === 0) return priceUsd(res.model, res.usage);
  return billed.reduce((sum, it) => sum + priceUsd(it.model ?? res.model, it), 0);
}

function rawProposal(res: Response): unknown {
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  try {
    return JSON.parse(text);
  } catch {
    // Untrusted output that isn't JSON fails packet validation, which gives the model its one retry.
    return { unparseable: text };
  }
}

/**
 * Real model behind `AnalysisAdapter`: one structured-output call per proposing step. The result is untrusted
 * `raw` output; `validatePacket` decides what of it becomes a packet. Credentials come from the environment and
 * the client is created on the first call, so constructing the adapter never needs them.
 */
export function createClaudeAnalysis(opts: { client?: Anthropic; model?: string; now?: () => number } = {}): AnalysisAdapter {
  const model = opts.model ?? CLAUDE_ANALYSIS_MODEL;
  const now = opts.now ?? Date.now;
  let client = opts.client;

  return {
    async proposeFeedback(input: AnalysisInput): Promise<{ raw: unknown; usage: UsageReport }> {
      client ??= new Anthropic();
      const t0 = now();
      const res = await client.beta.messages.create(
        {
          model,
          max_tokens: MAX_TOKENS,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: "high", format: { type: "json_schema", schema: PROPOSAL_JSON_SCHEMA } },
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: renderAnalysisInput(input) }],
        },
        { timeout: TIMEOUT_MS },
      );
      if (res.stop_reason === "refusal") {
        throw new ClaudeAnalysisError("refusal", `Claude refused the analysis request (category: ${res.stop_details?.category ?? "none"})`);
      }
      if (res.stop_reason === "max_tokens") {
        throw new ClaudeAnalysisError("truncated", "Claude analysis output was truncated (max_tokens)");
      }
      return {
        raw: rawProposal(res),
        usage: { inferenceCalls: 1, inferenceUsd: costOf(res), wallClockMs: now() - t0 },
      };
    },
  };
}
