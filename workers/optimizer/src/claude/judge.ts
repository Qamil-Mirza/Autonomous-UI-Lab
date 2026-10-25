import { readFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { JudgeVerdict, type JudgeInput, type TrialJudge } from "@ghostloop/contracts";
import { priceUsd } from "./pricing";
import { JUDGE_JSON_SCHEMA, JUDGE_SYSTEM_PROMPT, renderJudgeInput } from "./judge-prompt";

export const JUDGE_MODEL = "claude-opus-5-5";
/** Bump when the judge's instructions change, so a comparison never mixes two judges. */
export const JUDGE_INSTRUCTION_VERSION = "judge-v1";
const MAX_TOKENS = 4000;
const TIMEOUT_MS = 120_000;

type Response = Anthropic.Beta.BetaMessage;

function costOf(res: Response): number {
  const billed = (res.usage.iterations ?? []).filter((it) => it.type === "message" || it.type === "fallback_message");
  if (billed.length === 0) return priceUsd(res.model, res.usage);
  return billed.reduce((sum, it) => sum + priceUsd(it.model ?? res.model, it), 0);
}

/**
 * Claude scores one trial's final state against the task as written. A refusal, a truncated answer, or output that is
 * not a valid verdict throws, which the simulator records as a model error rather than a pass or a fail. The client is
 * created on the first call, so building the judge never needs credentials.
 */
export function createClaudeJudge(
  opts: { client?: Anthropic; model?: string; readImage?: (path: string) => Promise<Buffer> } = {},
): TrialJudge {
  const model = opts.model ?? JUDGE_MODEL;
  const readImage = opts.readImage ?? ((path: string) => readFile(path));
  let client = opts.client;
  return {
    info: { model, instructionVersion: JUDGE_INSTRUCTION_VERSION },
    async judge(input: JudgeInput, signal: AbortSignal) {
      client ??= new Anthropic();
      const images = await Promise.all(input.screenshots.map((s) => readImage(s.path)));
      const content: Anthropic.Beta.BetaContentBlockParam[] = [{ type: "text", text: renderJudgeInput(input) }];
      images.forEach((data, i) => {
        content.push({ type: "text", text: `Image ${i + 1}: ${input.screenshots[i]!.label}` });
        content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: data.toString("base64") } });
      });
      const res = await client.beta.messages.create(
        {
          model,
          max_tokens: MAX_TOKENS,
          output_config: { effort: "high", format: { type: "json_schema", schema: JUDGE_JSON_SCHEMA } },
          system: JUDGE_SYSTEM_PROMPT,
          messages: [{ role: "user", content }],
        },
        { timeout: TIMEOUT_MS, signal },
      );
      if (res.stop_reason === "refusal") throw new Error("Claude refused to judge the trial");
      if (res.stop_reason === "max_tokens") throw new Error("Claude's verdict was truncated (max_tokens)");
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        throw new Error("Claude's verdict was not JSON");
      }
      const verdict = JudgeVerdict.safeParse(raw);
      if (!verdict.success) throw new Error(`Claude's verdict did not match the schema: ${verdict.error.issues[0]?.message ?? "invalid"}`);
      return { verdict: verdict.data, usd: costOf(res) };
    },
  };
}
