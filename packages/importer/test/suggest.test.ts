import { describe, expect, it } from "vitest";
import { findRoutes, groundSuggestions } from "../src/suggest";
import type { SuccessCheck } from "../src/task";

const appTexts = [{ text: "Order ahead for pickup" }, { text: "Order confirmed" }, { text: "Your order NW-1042 will be ready at the counter." }, { text: "Track my order" }];
const routes = ["/", "/bag", "/checkout", "/order/confirmed"];
// Only "Order ahead" text is on the starting page.
const passesAtStart = async (c: SuccessCheck) => c.kind === "text" && "order ahead for pickup".includes(c.text.toLowerCase());

describe("groundSuggestions", () => {
  it("keeps grounded checks that are not already true at the start", async () => {
    const r = await groundSuggestions(
      { checks: [
        { kind: "route", path: "/order/confirmed", why: "the confirmation route" },
        { kind: "text", text: "Order confirmed", match: "contains", why: "the confirmation heading" },
      ] },
      { appTexts, routes, startRoute: "/", passesAtStart },
    );
    expect(r.suggestions).toEqual([
      { check: { kind: "route", path: "/order/confirmed", match: "exact" }, why: "the confirmation route" },
      { check: { kind: "text", text: "Order confirmed", match: "contains" }, why: "the confirmation heading" },
    ]);
    expect(r.rejected).toEqual([]);
  });

  it("sets aside invented, trivial and invalid proposals with a reason", async () => {
    const r = await groundSuggestions(
      { checks: [
        { kind: "route", path: "/thank-you", why: "invented" },
        { kind: "route", path: "/", why: "start" },
        { kind: "text", text: "Payment successful", why: "invented text" },
        { kind: "text", text: "Order ahead", why: "already visible" },
        { kind: "control", role: "spaceship", name: "Track my order", why: "bad role" },
        { kind: "control", role: "button", name: "Track my order", why: "ok" },
      ] },
      { appTexts, routes, startRoute: "/", passesAtStart },
    );
    expect(r.suggestions.map((s) => s.check)).toEqual([{ kind: "control", role: "button", name: "Track my order" }]);
    expect(r.rejected.map((x) => x.reason)).toEqual([
      "the app's code never mentions the route /thank-you",
      "that is the starting route",
      "“Payment successful” is not text this app shows",
      "it is already true on the starting page",
      expect.stringMatching(/Invalid enum value/),
    ]);
  });

  it("keeps at most three and survives malformed output", async () => {
    const many = ["Order confirmed", "Your order NW-1042", "will be ready", "at the counter"].map((text) => ({ kind: "text", text, why: "" }));
    const r = await groundSuggestions({ checks: many }, { appTexts, routes, startRoute: "/", passesAtStart });
    expect(r.suggestions).toHaveLength(3);
    expect(r.rejected[0]!.reason).toMatch(/first 3/);
    expect((await groundSuggestions("nonsense", { appTexts, routes, startRoute: "/", passesAtStart })).suggestions).toEqual([]);
  });
});

describe("findRoutes", () => {
  it("collects route-like literals from source, not imports or file paths", () => {
    const files = new Map([
      ["src/App.tsx", Buffer.from(`import x from "./x"; go("/checkout"); <a href='/order/confirmed/'>; const u = "//cdn.example"; navigate(\`/bag\`);`)],
      ["index.html", Buffer.from(`<script src="/src/main.tsx">`)],
    ]);
    expect(findRoutes(files)).toEqual(["/bag", "/checkout", "/order/confirmed"]);
  });
});
