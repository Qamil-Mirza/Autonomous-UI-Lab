import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseAdapterFlag, screenshotPublisher } from "../src/real-adapters";

describe("parseAdapterFlag", () => {
  it("defaults to mock, and --real makes every adapter real", () => {
    expect(parseAdapterFlag([], "simulation")).toBe("mock");
    expect(parseAdapterFlag(["--real"], "simulation")).toBe("real");
    expect(parseAdapterFlag(["--real"], "candidates")).toBe("real");
  });

  it("lets an explicit flag override --real", () => {
    expect(parseAdapterFlag(["--real", "--candidates", "mock"], "candidates")).toBe("mock");
    expect(parseAdapterFlag(["--simulation", "real"], "simulation")).toBe("real");
  });

  it("rejects anything else", () => {
    expect(() => parseAdapterFlag(["--simulation", "live"], "simulation")).toThrow("--simulation must be one of: mock, real");
    expect(() => parseAdapterFlag(["--candidates"], "candidates")).toThrow("--candidates must be one of: mock, real");
  });
});

describe("screenshotPublisher", () => {
  const root = path.resolve("/tmp/ghostloop-artifacts");
  const publish = screenshotPublisher(root);

  it("maps a screenshot under the artifacts directory to its /artifacts URL", async () => {
    const shot = { uri: path.join(root, "batches", "batch_1", "run_a b", "000.png"), width: 1280, height: 800 };
    await expect(publish(shot)).resolves.toEqual({ uri: "/artifacts/batches/batch_1/run_a%20b/000.png", width: 1280, height: 800 });
  });

  it("leaves screenshots outside the artifacts directory unchanged", async () => {
    const outside = { uri: path.resolve("/tmp/elsewhere/000.png"), width: 1, height: 1 };
    await expect(publish(outside)).resolves.toEqual(outside);
    const sibling = { uri: `${root}-other/000.png`, width: 1, height: 1 };
    await expect(publish(sibling)).resolves.toEqual(sibling);
  });
});
