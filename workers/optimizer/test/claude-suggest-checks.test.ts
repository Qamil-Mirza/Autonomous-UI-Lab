import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { createClaudeCheckSuggester, renderSuggestInput, SUGGEST_MODEL } from "../src/claude/suggest-checks";

const input = {
  task: "Order one flat white for pickup.",
  startRoute: "/",
  startPage: { url: "http://127.0.0.1:47100/", text: "Order ahead for pickup", controls: [{ role: "button", label: "Add Flat white" }], screenshotPath: "/tmp/x.png" },
  appTexts: [{ text: "Order confirmed", file: "src/components/Confirmation.tsx" }],
  routes: ["/", "/order/confirmed"],
};

function fakeClient(response: object) {
  const create = vi.fn(async () => ({ model: SUGGEST_MODEL, usage: { input_tokens: 1000, output_tokens: 200 }, stop_reason: "end_turn", ...response }));
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, create };
}

describe("Claude check suggester", () => {
  it("sends the task, the starting page, app texts, routes and the screenshot; returns untrusted raw output and cost", async () => {
    const { client, create } = fakeClient({ content: [{ type: "text", text: JSON.stringify({ checks: [{ kind: "route", path: "/order/confirmed", why: "x" }] }) }] });
    const s = createClaudeCheckSuggester({ client, readImage: async () => Buffer.from("png") });
    const out = await s.suggest(input);
    expect(out.raw).toEqual({ checks: [{ kind: "route", path: "/order/confirmed", why: "x" }] });
    expect(out.usd).toBeCloseTo((1000 * 4 + 200 * 20) / 1e6);
    const body = (create.mock.calls[0] as unknown[])[0] as { messages: { content: { type: string }[] }[]; output_config: { format: { type: string } } };
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.messages[0]!.content.map((c) => c.type)).toEqual(["text", "text", "image"]);
    expect(renderSuggestInput(input)).toContain('"/order/confirmed"');
  });

  it("fails loudly on refusal and tolerates non-JSON as no suggestions", async () => {
    await expect(createClaudeCheckSuggester({ client: fakeClient({ stop_reason: "refusal", content: [] }).client, readImage: async () => Buffer.from("") }).suggest(input)).rejects.toThrow(/declined/);
    const out = await createClaudeCheckSuggester({ client: fakeClient({ content: [{ type: "text", text: "not json" }] }).client, readImage: async () => Buffer.from("") }).suggest(input);
    expect(out.raw).toEqual({ checks: [] });
  });
});
