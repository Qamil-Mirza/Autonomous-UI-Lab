import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setGlobalLogLevel } from "spacetimedb";
import type { CommandKind } from "@ghostloop/contracts";
import { connect, reducerErrorCode, submitCommand, type CommandRow, type Connected, type EventContext } from "../src/index";
import { dropConnection, publishTestDb } from "../test-support/live";

setGlobalLogLevel("warn"); // keep the SDK's per-connection info lines out of test output

async function rejectionCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return reducerErrorCode(e);
  }
  throw new Error("expected the reducer to reject");
}

describe.skipIf(!process.env.GHOSTLOOP_STDB_TEST)("spacetimedb module (live)", () => {
  let writer: Connected;
  let other: Connected;
  let target: { uri: string; database: string };

  beforeAll(async () => {
    target = await publishTestDb("ghostloop-test-db");
    writer = await connect(target);
    await writer.conn.reducers.claimWriter({});
    other = await connect(target);
  }, 180_000);

  afterAll(() => {
    writer?.conn.disconnect();
    other?.conn.disconnect();
  });

  beforeEach(async () => {
    await writer.conn.reducers.devReset({});
  });

  it("rejections reach the client as `CODE: detail` messages", async () => {
    await expect(other.conn.reducers.devReset({})).rejects.toThrow(/^NOT_WRITER: caller is not the writer$/);
  });

  it("a duplicate insertAction is a no-op", async () => {
    await writer.conn.reducers.insertAction({ runId: "run_1", seq: 1, json: '{"n":1}' });
    await writer.conn.reducers.insertAction({ runId: "run_1", seq: 1, json: '{"n":2}' });
    expect([...writer.conn.db.agentAction.iter()]).toEqual([{ key: "run_1:1", runId: "run_1", seq: 1, json: '{"n":1}' }]);
  });

  it("insertVersion is insert-only", async () => {
    await writer.conn.reducers.insertVersion({ id: "ver_1", parentId: undefined, json: "{}" });
    expect(await rejectionCode(writer.conn.reducers.insertVersion({ id: "ver_1", parentId: undefined, json: "{}" })))
      .toBe("ALREADY_EXISTS");
  });

  it("putExperiment enforces expectedRev and increments rev by 1", async () => {
    const put = (expectedRev: bigint) =>
      writer.conn.reducers.putExperiment({ id: "exp_1", state: "created", round: 0, expectedRev, json: "{}" });
    await put(0n);
    expect(writer.conn.db.experiment.id.find("exp_1")?.rev).toBe(1n);
    expect(await rejectionCode(put(0n))).toBe("STALE_REV");
    await put(1n);
    expect(writer.conn.db.experiment.id.find("exp_1")?.rev).toBe(2n);
  });

  it("putApproval is insert-only and rejects a stale source version", async () => {
    await writer.conn.reducers.putExperiment({
      id: "exp_1", state: "awaiting_approval", round: 0, expectedRev: 0n, json: JSON.stringify({ incumbentVersionId: "ver_1" }),
    });
    const approve = (sourceVersionId: string) =>
      writer.conn.reducers.putApproval({ experimentId: "exp_1", round: 0, sourceVersionId, json: "{}" });
    expect(await rejectionCode(approve("ver_0"))).toBe("STALE_SOURCE_VERSION");
    await approve("ver_1");
    expect(await rejectionCode(approve("ver_1"))).toBe("ALREADY_EXISTS");
  });

  it("putCandidate rejects moving a candidate to another experiment", async () => {
    await writer.conn.reducers.putCandidate({ id: "cand_1", experimentId: "exp_1", json: "{}" });
    expect(await rejectionCode(writer.conn.reducers.putCandidate({ id: "cand_1", experimentId: "exp_2", json: "{}" })))
      .toBe("OWNER_MISMATCH");
  });

  it("rejects a json argument over 256 KiB", async () => {
    const json = "x".repeat(262145);
    expect(await rejectionCode(writer.conn.reducers.putBatch({ id: "batch_1", experimentId: "exp_1", round: 0, json })))
      .toBe("TOO_LARGE");
  });

  it("a non-writer cannot write domain tables but can submit commands", async () => {
    expect(await rejectionCode(other.conn.reducers.putBatch({ id: "batch_1", experimentId: "exp_1", round: 0, json: "{}" })))
      .toBe("NOT_WRITER");
    expect(await rejectionCode(other.conn.reducers.devReset({}))).toBe("NOT_WRITER");
    await other.conn.reducers.submitCommand({ kind: "startExperiment", payloadJson: '{"experimentId":"exp_1"}' });
    // The submitter's own cache reflects its write once the call resolves; the writer's may lag.
    expect([...other.conn.db.command.iter()].map((c) => c.status)).toEqual(["pending"]);
    expect(await rejectionCode(submitCommand(other.conn, "launchRocket" as CommandKind, {}))).toBe("UNKNOWN_COMMAND");
  });

  it("startCommand needs a pending row and completeCommand a running one", async () => {
    await other.conn.reducers.submitCommand({ kind: "startExperiment", payloadJson: '{"experimentId":"exp_1"}' });
    const [cmd] = [...other.conn.db.command.iter()];
    const id = cmd!.id;
    expect(await rejectionCode(writer.conn.reducers.completeCommand({ id, ok: true, resultJson: "{}" }))).toBe("NOT_RUNNING");
    await writer.conn.reducers.startCommand({ id });
    expect(await rejectionCode(writer.conn.reducers.startCommand({ id }))).toBe("NOT_RUNNING");
    await writer.conn.reducers.completeCommand({ id, ok: true, resultJson: "{}" });
    expect(await rejectionCode(writer.conn.reducers.completeCommand({ id, ok: true, resultJson: "{}" }))).toBe("NOT_RUNNING");
    expect(await rejectionCode(writer.conn.reducers.startCommand({ id: id + 100n }))).toBe("NOT_RUNNING");
  });

  describe("submitCommand helper", () => {
    // Plays the worker: starts each pending row and completes it with `result(row)`.
    function serve(result: (row: CommandRow) => unknown): () => void {
      const onInsert = (_ctx: EventContext, row: CommandRow) => {
        if (row.status !== "pending") return;
        void (async () => {
          await writer.conn.reducers.startCommand({ id: row.id });
          await writer.conn.reducers.completeCommand({ id: row.id, ok: true, resultJson: JSON.stringify(result(row)) });
        })();
      };
      writer.conn.db.command.onInsert(onInsert);
      return () => writer.conn.db.command.removeOnInsert(onInsert);
    }

    it("resolves with the result the writer completes the row with", async () => {
      const stop = serve(() => ({ ok: true, value: 1 }));
      try {
        expect(await submitCommand(other.conn, "startExperiment", { experimentId: "exp_1" }, { timeoutMs: 5000 }))
          .toEqual({ ok: true, value: 1 });
      } finally {
        stop();
      }
    });

    it("concurrent submits from one connection each get their own result", async () => {
      const stop = serve((row) => ({ ok: true, value: JSON.parse(row.payloadJson).experimentId }));
      try {
        const ids = ["exp_a", "exp_b", "exp_c"];
        const results = await Promise.all(
          ids.map((experimentId) => submitCommand(other.conn, "startExperiment", { experimentId }, { timeoutMs: 5000 })),
        );
        expect(results).toEqual(ids.map((value) => ({ ok: true, value })));
      } finally {
        stop();
      }
    });

    it("rejects COMMAND_TIMEOUT when no worker completes the row", async () => {
      await expect(submitCommand(other.conn, "startExperiment", { experimentId: "exp_1" }, { timeoutMs: 300 }))
        .rejects.toThrow(/^COMMAND_TIMEOUT:/);
    });
  });

  describe("connect onDisconnect", () => {
    it("fires once when the connection drops after connect resolved", async () => {
      const lost: Error[] = [];
      const { conn } = await connect({ ...target, onDisconnect: (err) => lost.push(err) });
      dropConnection(conn);
      await expect.poll(() => lost.length, { timeout: 2000 }).toBe(1);
      expect(lost[0]).toBeInstanceOf(Error);
      expect(conn.isActive).toBe(false);
    });

    it("does not fire for a deliberate disconnect()", async () => {
      const lost: Error[] = [];
      const { conn } = await connect({ ...target, onDisconnect: (err) => lost.push(err) });
      conn.disconnect();
      await new Promise((r) => setTimeout(r, 300));
      expect(lost).toEqual([]);
    });
  });
});
