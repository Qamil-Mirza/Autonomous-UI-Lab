/** USD per million tokens, Anthropic first-party rates. */
type Rates = { input: number; output: number; cacheRead: number; cacheWrite: number };

const RATES: Record<string, Rates> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
};
// An unknown model (e.g. a new fallback target) is priced at the top rate so cost is never under-reported.
const MOST_EXPENSIVE = RATES["claude-fable-5-1"]!;

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function priceUsd(model: string, usage: TokenUsage): number {
  const r = RATES[model] ?? MOST_EXPENSIVE;
  const tokens =
    usage.input_tokens * r.input +
    usage.output_tokens * r.output +
    (usage.cache_read_input_tokens ?? 0) * r.cacheRead +
    (usage.cache_creation_input_tokens ?? 0) * r.cacheWrite;
  return tokens / 1_000_000;
}
