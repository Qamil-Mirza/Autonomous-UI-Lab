import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setGlobalLogLevel } from "spacetimedb";
import { publishTestDb } from "@ghostloop/db/test-support";
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

  it("rejects an unknown store name", async () => {
    await expect(main(["--store", "bogus"], () => {})).rejects.toThrow("--store must be one of: memory, spacetime");
  });
});

describe.skipIf(!process.env.GHOSTLOOP_STDB_TEST)("demo-mock CLI (live)", () => {
  it("--store spacetime drives the round and stops with USER_STOP", async () => {
    setGlobalLogLevel("warn");
    const target = await publishTestDb("ghostloop-test-demo");
    const saved = { uri: process.env.GHOSTLOOP_STDB_URI, db: process.env.GHOSTLOOP_STDB_DB };
    process.env.GHOSTLOOP_STDB_URI = target.uri;
    process.env.GHOSTLOOP_STDB_DB = target.database;
    try {
      const tokenPath = join(mkdtempSync(join(tmpdir(), "ghostloop-demo-")), "worker-token");
      const lines: string[] = [];
      const summary = await main(["--store", "spacetime"], (l) => lines.push(l), { tokenPath });
      expect(summary).toEqual({ state: "stopped", decision: "accepted", stoppingReason: "USER_STOP" });
      expect(lines.some((l) => l.startsWith("Hypotheses"))).toBe(true);
      expect(readFileSync(tokenPath, "utf8").length).toBeGreaterThan(0);
    } finally {
      for (const [k, v] of [["GHOSTLOOP_STDB_URI", saved.uri], ["GHOSTLOOP_STDB_DB", saved.db]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }, 180_000);
});
