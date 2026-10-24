import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect } from "vitest";
import { choosePlan, createRunStore, saveWorkspace, sendInvite, signup, type PlanChoice, type RunStore } from "../src";

export const ALEX = { name: "Alex Kim", email: "alex@northwind.test", password: "correct-horse", consent: true };

// A fresh temp runs directory per test.
export function useTempStore(): { store: () => RunStore; dir: () => string } {
  let dir = "";
  let store: RunStore | undefined;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ghostloop-runs-"));
    store = createRunStore(dir);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return {
    store: () => {
      if (!store) throw new Error("store used outside a test");
      return store;
    },
    dir: () => dir,
  };
}

// Drives the full onboarding flow through the actions, the way the app's API does.
export async function completeFlow(store: RunStore, runId: string, plan: PlanChoice = "free") {
  await store.init(runId);
  expect((await signup(store, runId, ALEX)).ok).toBe(true);
  expect((await saveWorkspace(store, runId, { name: "Northwind Sales" })).ok).toBe(true);
  expect((await choosePlan(store, runId, { plan })).ok).toBe(true);
  expect((await sendInvite(store, runId, { email: "jordan@northwind.test" })).ok).toBe(true);
}
