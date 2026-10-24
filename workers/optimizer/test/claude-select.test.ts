import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisInput } from "@ghostloop/contracts";
import { parseAnalysisFlag, selectAnalysis } from "../src/claude/select";
import { main } from "../src/cli/demo-mock";
import { defaultProposal } from "../src/mocks/analysis";

function claudeStub(create: (params: { messages: { content: string }[] }) => Promise<unknown>) {
  return { beta: { messages: { create: vi.fn(create) } } } as unknown as Anthropic;
}

/** Answers like Claude would: the default proposal for whatever observations the request carries. */
const answeringClient = () =>
  claudeStub(async (params) => {
    const doc = JSON.parse(params.messages[0]!.content.replace(/^[^{]*/, "")) as Pick<AnalysisInput, "observations">;
    return {
      model: "claude-opus-5-5",
      stop_reason: "end_turn",
      stop_details: null,
      content: [{ type: "text", text: JSON.stringify(defaultProposal(doc as AnalysisInput)) }],
      usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, iterations: null },
    };
  });

describe("parseAnalysisFlag", () => {
  it("defaults to mock and accepts claude", () => {
    expect(parseAnalysisFlag([])).toBe("mock");
    expect(parseAnalysisFlag(["--analysis", "claude"])).toBe("claude");
    expect(parseAnalysisFlag(["--analysis", "mock"])).toBe("mock");
  });

  it("rejects anything else", () => {
    expect(() => parseAnalysisFlag(["--analysis", "bogus"])).toThrow("--analysis must be one of: mock, claude");
    expect(() => parseAnalysisFlag(["--analysis"])).toThrow("--analysis must be one of: mock, claude");
  });
});

describe("selectAnalysis credentials warning", () => {
  const saved = { key: process.env.ANTHROPIC_API_KEY, token: process.env.ANTHROPIC_AUTH_TOKEN };
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
  });
  afterEach(() => {
    if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved.key;
    if (saved.token === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
    else process.env.ANTHROPIC_AUTH_TOKEN = saved.token;
  });

  it("warns about ANTHROPIC_API_KEY for claude when no credentials are set", () => {
    const warn = vi.fn();
    selectAnalysis("claude", { warn });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ANTHROPIC_API_KEY is not set"));
  });

  it("does not warn when a key is set, or for mock", () => {
    const warn = vi.fn();
    selectAnalysis("mock", { warn });
    process.env.ANTHROPIC_API_KEY = "test-not-a-real-key";
    selectAnalysis("claude", { warn });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("demo-mock --analysis claude", () => {
  it("drives the round through the Claude adapter and labels the mode", async () => {
    const lines: string[] = [];
    const summary = await main(["--analysis", "claude"], (l) => lines.push(l), { analysisClient: answeringClient() });
    expect(summary).toMatchObject({ state: "stopped", decision: "accepted", stoppingReason: "USER_STOP" });
    expect(lines).toContain("analysis: Claude (claude-opus-5-5)");
  });

  it("labels the default run as mock", async () => {
    const lines: string[] = [];
    await main([], (l) => lines.push(l));
    expect(lines).toContain("analysis: mock");
  });

  it("stops with INTEGRATION_FAILURE carrying the SDK error when authentication fails", async () => {
    const client = claudeStub(async () => {
      throw new Anthropic.AuthenticationError(401, undefined, "invalid x-api-key", new Headers());
    });
    const err = await main(["--analysis", "claude"], () => {}, { analysisClient: client }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("INTEGRATION_FAILURE");
    expect((err as Error).message).toContain("invalid x-api-key");
  });
});
