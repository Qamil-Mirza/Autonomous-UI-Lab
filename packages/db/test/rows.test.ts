import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { Experiment, ExperimentProtocol } from "@ghostloop/contracts";
import { loadFixture } from "@ghostloop/contracts/fixtures";
import { parseRow, reducerErrorCode, RowValidationError } from "../src/index";

const protocol = loadFixture("protocol.default.json", ExperimentProtocol);
const experiment: Experiment = {
  schemaVersion: "1.0.0",
  id: "exp_x",
  protocol,
  state: "created",
  incumbentVersionId: protocol.baseVersionId,
  round: { index: 0, analysisAttempts: 0 },
  transitions: [],
  usage: { inferenceCalls: 0, inferenceUsd: 0, wallClockMs: 0 },
  cancelRequested: false,
};

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected a throw");
}

describe("parseRow", () => {
  it("rejects malformed JSON with the table and key", () => {
    const e = catchError(() => parseRow(Experiment, "experiment", "exp_x", "{"));
    expect(e).toBeInstanceOf(RowValidationError);
    expect((e as Error).message).toContain("experiment exp_x");
  });

  it("rejects JSON that fails the schema with the table and key", () => {
    const e = catchError(() => parseRow(Experiment, "experiment", "exp_x", JSON.stringify({ id: "exp_x" })));
    expect(e).toBeInstanceOf(RowValidationError);
    expect((e as Error).message).toContain("experiment exp_x");
  });

  it("round-trips a valid record", () => {
    expect(parseRow(Experiment, "experiment", "exp_x", JSON.stringify(experiment))).toEqual(experiment);
  });
});

describe("reducerErrorCode", () => {
  it("extracts the CODE prefix, with or without a client prefix", () => {
    expect(reducerErrorCode(new Error("NOT_WRITER: caller is not the writer"))).toBe("NOT_WRITER");
    expect(reducerErrorCode(new Error("Reducer failed: STALE_REV: experiment exp_1 expected rev 0, have 1"))).toBe("STALE_REV");
    expect(reducerErrorCode("TOO_LARGE: 262145 > 262144")).toBe("TOO_LARGE");
  });

  it("returns undefined when there is no code", () => {
    expect(reducerErrorCode(new Error("socket closed"))).toBeUndefined();
    expect(reducerErrorCode(undefined)).toBeUndefined();
  });
});

describe("browser safety", () => {
  const srcDir = join(import.meta.dirname, "../src");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : [p];
    });

  it("src (outside generated bindings) uses no Node-only APIs", () => {
    const offenders = files(srcDir)
      .filter((p) => !relative(srcDir, p).startsWith("bindings"))
      .filter((p) => /from "node:|process\./.test(readFileSync(p, "utf8")));
    expect(offenders).toEqual([]);
  });
});
