import { describe, expect, it } from "vitest";
import { main } from "../src/cli/demo-mock";

describe("demo-mock CLI", () => {
  it("flat candidate ends inconclusive with INCONCLUSIVE stopping reason", async () => {
    const lines: string[] = [];
    const summary = await main(["--candidate", "flat"], (l) => lines.push(l));
    expect(summary).toMatchObject({ state: "stopped", decision: "inconclusive", stoppingReason: "INCONCLUSIVE" });
    expect(lines[0]).toContain("MOCK MODE");
  });

  it("rejects an unknown candidate name", async () => {
    await expect(main(["--candidate", "nope"], () => {})).rejects.toThrow(/--candidate/);
  });
});
