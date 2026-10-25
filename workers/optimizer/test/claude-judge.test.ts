import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import type { JudgeInput } from "@ghostloop/contracts";
import { createClaudeJudge, JUDGE_INSTRUCTION_VERSION, JUDGE_MODEL } from "../src/claude/judge";
import { JUDGE_SYSTEM_PROMPT } from "../src/claude/judge-prompt";

const input: JudgeInput = {
  task: "Invite a teammate, then go to the dashboard",
  scenario: { description: "You are new to this product.", inputs: { inviteEmail: "teammate@example.com", password: "[redacted]" } },
  steps: [
    { seq: 0, action: "click", target: "Send invite", reason: "invite the teammate", result: "ok", screenBefore: "invite", screenAfter: "confirm" },
    { seq: 1, action: "click", target: "Go to dashboard", reason: "finish on the dashboard", result: "ok", screenBefore: "confirm", screenAfter: "confirm" },
    { seq: 2, action: "stop", target: "session", reason: "done", result: "ok", screenBefore: "confirm", screenAfter: "confirm" },
  ],
  screens: ["invite", "confirm"],
  finalScreen: "confirm",
  appState: [{ name: "invite_sent", passed: true, detail: "1 valid invite" }],
  screenshots: [
    { label: "before leaving invite", path: "/shots/1.png" },
    { label: "final screen (confirm)", path: "/shots/2.png" },
  ],
};

type Params = { model: string; system: string; output_config: { format: { type: string } }; messages: { content: { type: string; text?: string; source?: { data: string } }[] }[] };

function stub(answer: { text?: string; stop_reason?: string }) {
  const create = vi.fn(async (_p: Params) => ({
    model: JUDGE_MODEL,
    stop_reason: answer.stop_reason ?? "end_turn",
    stop_details: null,
    content: answer.text === undefined ? [] : [{ type: "text", text: answer.text }],
    usage: { input_tokens: 5000, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, iterations: null },
  }));
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, create };
}
const readImage = async (p: string) => Buffer.from(`png:${p}`);

describe("createClaudeJudge", () => {
  it("asks claude-opus-5-5 with structured output, the task verbatim and one image per screenshot", async () => {
    const { client, create } = stub({ text: JSON.stringify({ reached: false, explanation: "No dashboard page exists; the trial ended on confirm.", evidence: ["step 1"] }) });
    const judge = createClaudeJudge({ client, readImage });
    const { verdict, usd } = await judge.judge(input, new AbortController().signal);
    expect(verdict).toEqual({ reached: false, explanation: "No dashboard page exists; the trial ended on confirm.", evidence: ["step 1"] });
    expect(usd).toBeGreaterThan(0);
    const params = create.mock.calls[0]![0];
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.system).toBe(JUDGE_SYSTEM_PROMPT);
    expect(params.output_config.format.type).toBe("json_schema");
    const content = params.messages[0]!.content;
    expect(content.filter((b) => b.type === "image")).toHaveLength(2);
    expect(content[0]!.text).toContain("Invite a teammate, then go to the dashboard");
    expect(content.some((b) => b.text?.includes("final screen (confirm)"))).toBe(true);
    expect(Buffer.from(content.find((b) => b.type === "image")!.source!.data, "base64").toString()).toBe("png:/shots/1.png");
    expect(judge.info).toEqual({ model: "claude-opus-5-5", instructionVersion: JUDGE_INSTRUCTION_VERSION });
  });

  it("accepts an uncertain verdict", async () => {
    const { client } = stub({ text: JSON.stringify({ reached: "uncertain", explanation: "Final screenshot is cut off.", evidence: [] }) });
    const { verdict } = await createClaudeJudge({ client, readImage }).judge(input, new AbortController().signal);
    expect(verdict.reached).toBe("uncertain");
  });

  it("throws on a refusal, a truncated answer or text that isn't a verdict", async () => {
    for (const answer of [{ stop_reason: "refusal", text: "" }, { stop_reason: "max_tokens", text: "{" }, { text: "I think it worked" }, { text: JSON.stringify({ reached: "maybe", explanation: "x", evidence: [] }) }]) {
      const { client } = stub(answer);
      await expect(createClaudeJudge({ client, readImage }).judge(input, new AbortController().signal)).rejects.toThrow();
    }
  });

  it("builds without credentials until the first call", () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => createClaudeJudge()).not.toThrow();
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  it("tells the judge to score the final state and treat reasons as claims", () => {
    expect(JUDGE_SYSTEM_PROMPT).toMatch(/final state/i);
    expect(JUDGE_SYSTEM_PROMPT).toMatch(/claim/i);
    expect(JUDGE_SYSTEM_PROMPT).toMatch(/uncertain/);
  });
});
