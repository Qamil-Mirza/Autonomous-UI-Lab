import { setGlobalLogLevel } from "spacetimedb";
import { describe, expect, it } from "vitest";
import { connect } from "../src/index";

setGlobalLogLevel("warn"); // keep the SDK's per-connection info lines out of test output

describe("connect", () => {
  it("rejects with CONNECT_FAILED when nothing is listening", async () => {
    const t0 = Date.now();
    await expect(connect({ uri: "ws://127.0.0.1:1", timeoutMs: 1000 })).rejects.toThrow(/^CONNECT_FAILED:/);
    expect(Date.now() - t0).toBeLessThan(3000);
  }, 5000);
});
