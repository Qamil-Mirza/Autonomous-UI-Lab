import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setGlobalLogLevel } from "spacetimedb";
import { ExperimentProtocol, type Experiment } from "@ghostloop/contracts";
import { loadFixture } from "@ghostloop/contracts/fixtures";
import { publishTestDb } from "@ghostloop/db/test-support";
import { SpacetimeStore } from "../src/spacetime-store";
import { runStoreContract } from "./store-contract";

setGlobalLogLevel("warn"); // keep the SDK's per-connection info lines out of test output

const protocol = loadFixture("protocol.default.json", ExperimentProtocol);
const mkExperiment = (id: string): Experiment => ({
  schemaVersion: "1.0.0",
  id: id as Experiment["id"],
  protocol,
  state: "baseline_running",
  incumbentVersionId: "ver_base0001",
  round: { index: 1, analysisAttempts: 0 },
  transitions: [],
  usage: { inferenceCalls: 0, inferenceUsd: 0, wallClockMs: 0 },
  cancelRequested: false,
});

/** Polls `check` until it returns true; another connection's cache lags this one's writes. */
async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe.skipIf(!process.env.GHOSTLOOP_STDB_TEST)("SpacetimeStore (live)", () => {
  let target: { uri: string; database: string };
  let token: string;

  beforeAll(async () => {
    target = await publishTestDb("ghostloop-test-store");
    // The first store to open claims the writer slot; every other store reuses its identity.
    const first = await SpacetimeStore.open(target);
    token = first.token;
    await first.close();
  }, 180_000);

  runStoreContract("SpacetimeStore", async () => {
    const store = await SpacetimeStore.open({ ...target, token });
    await store.devReset();
    return { store, close: () => store.close() };
  });

  describe("across connections", () => {
    const open: SpacetimeStore[] = [];
    const openStore = async () => {
      const s = await SpacetimeStore.open({ ...target, token });
      open.push(s);
      return s;
    };
    let a: SpacetimeStore;

    beforeEach(async () => {
      a = await openStore();
      await a.devReset();
    });
    afterEach(async () => {
      await Promise.all(open.splice(0).map((s) => s.close()));
    });

    it("two stores updating one experiment concurrently lose no increments", async () => {
      const b = await openStore();
      await a.putExperiment(mkExperiment("exp_race0001"));
      await waitFor(async () => (await b.getExperiment("exp_race0001")) !== undefined);
      const bump = (s: SpacetimeStore) =>
        s.updateExperiment("exp_race0001", (x) => ({
          ...x,
          usage: { ...x.usage, inferenceCalls: x.usage.inferenceCalls + 1 },
        }));
      await Promise.all([...Array.from({ length: 10 }, () => bump(a)), ...Array.from({ length: 10 }, () => bump(b))]);
      await waitFor(async () => (await a.getExperiment("exp_race0001"))!.usage.inferenceCalls === 20);
      await waitFor(async () => (await b.getExperiment("exp_race0001"))!.usage.inferenceCalls === 20);
    });

    it("a store opened after a write reads it immediately", async () => {
      await a.putExperiment(mkExperiment("exp_seen0001"));
      const b = await openStore();
      expect(await b.getExperiment("exp_seen0001")).toEqual(mkExperiment("exp_seen0001"));
    });

    it("a listener sees writes made through another store", async () => {
      const b = await openStore();
      const seen: string[] = [];
      a.onChange((t, k) => seen.push(`${t}:${k}`));
      await b.putExperiment(mkExperiment("exp_remote01"));
      await waitFor(() => seen.includes("experiments:exp_remote01"));
    });

    it("a different identity cannot open once the writer is claimed", async () => {
      const err = await SpacetimeStore.open(target).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/^NOT_WRITER:/);
      expect((err as Error).message).toContain("npm run stdb:publish:fresh");
    });
  });
});
