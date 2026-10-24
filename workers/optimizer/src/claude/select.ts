import type Anthropic from "@anthropic-ai/sdk";
import type { AnalysisAdapter } from "@ghostloop/contracts";
import { createMockAnalysis } from "../mocks/analysis";
import { CLAUDE_ANALYSIS_MODEL, createClaudeAnalysis } from "./analysis";

export type AnalysisChoice = "mock" | "claude";

/** `--analysis mock|claude`; absent means mock. */
export function parseAnalysisFlag(argv: string[]): AnalysisChoice {
  const i = argv.indexOf("--analysis");
  const v = i < 0 ? "mock" : argv[i + 1];
  if (v !== "mock" && v !== "claude") throw new Error("--analysis must be one of: mock, claude");
  return v;
}

export const analysisLabel = (choice: AnalysisChoice) => (choice === "claude" ? `Claude (${CLAUDE_ANALYSIS_MODEL})` : "mock");

/**
 * Builds the analysis adapter for a CLI. Without an env credential the Claude call can still succeed through an
 * `ant auth login` profile, so a missing key is a warning, not an error.
 */
export function selectAnalysis(choice: AnalysisChoice, opts: { client?: Anthropic; warn?: (line: string) => void } = {}): AnalysisAdapter {
  if (choice === "mock") return createMockAnalysis([], 0.05);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    opts.warn?.("ANTHROPIC_API_KEY is not set; the Claude call will fail unless an `ant auth login` profile is active");
  }
  return createClaudeAnalysis(opts.client ? { client: opts.client } : {});
}
