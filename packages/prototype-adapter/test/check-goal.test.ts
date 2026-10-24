import { describe, expect, it } from "vitest";
import { GoalCheckResult } from "@ghostloop/contracts";
import { checkGoal, choosePlan, emptyRunState, GOAL_CHECKS, RunNotFoundError, saveWorkspace, sendInvite, signup } from "../src";
import { ALEX, completeFlow, useTempStore } from "./helpers";

const t = useTempStore();

async function failing(runId: string) {
  const result = await checkGoal(runId, { dir: t.dir() });
  expect(GoalCheckResult.safeParse(result).success).toBe(true);
  return result.checks.filter((c) => !c.passed).map((c) => c.name);
}

describe("checkGoal", () => {
  it("is achieved for a complete Free run, with every check passing", async () => {
    await completeFlow(t.store(), "run_ok");
    const result = await checkGoal("run_ok", { dir: t.dir() });
    expect(result.achieved).toBe(true);
    expect(result.runId).toBe("run_ok");
    expect(result.checks.map((c) => c.name)).toEqual([...GOAL_CHECKS]);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  it("fails account_created when signup never happened", async () => {
    const s = t.store();
    await s.init("run_nosignup");
    await saveWorkspace(s, "run_nosignup", { name: "Northwind" });
    await choosePlan(s, "run_nosignup", { plan: "free" });
    await sendInvite(s, "run_nosignup", { email: "jordan@northwind.test" });
    expect(await failing("run_nosignup")).toEqual(["account_created"]);
  });

  it("fails account_created for invalid signup data written directly to state", async () => {
    await completeFlow(t.store(), "run_badacct");
    const state = (await t.store().get("run_badacct"))!;
    await t.store().put("run_badacct", { ...state, account: { name: " ", email: "nope", consent: false, passwordLength: 3 } });
    const result = await checkGoal("run_badacct", { dir: t.dir() });
    expect(result.achieved).toBe(false);
    const account = result.checks.find((c) => c.name === "account_created")!;
    expect(account.passed).toBe(false);
    expect(account.detail).toMatch(/name is blank.*email.*invalid.*password is 3.*consent not given/);
  });

  it("rejects invalid signup input without recording an account", async () => {
    const s = t.store();
    await s.init("run_badsignup");
    const result = await signup(s, "run_badsignup", { name: "", email: "x", password: "short", consent: false });
    expect(result).toEqual({ ok: false, reason: "invalid", errors: ["name", "email", "password", "consent"] });
    expect((await s.get("run_badsignup"))?.account).toBeNull();
  });

  it("fails exactly_one_workspace when two workspaces are inserted directly", async () => {
    await completeFlow(t.store(), "run_two");
    const state = (await t.store().get("run_two"))!;
    const first = state.workspaces[0]!;
    await t.store().put("run_two", { ...state, workspaces: [first, { ...first, id: "ws_second", name: "Northwind 2" }] });
    const result = await checkGoal("run_two", { dir: t.dir() });
    expect(await failing("run_two")).toEqual(["exactly_one_workspace"]);
    expect(result.checks[1]?.detail).toBe("2 workspaces: Northwind Sales, Northwind 2");
  });

  it("keeps exactly one workspace when the workspace step is resubmitted", async () => {
    await completeFlow(t.store(), "run_resubmit");
    await saveWorkspace(t.store(), "run_resubmit", { name: "Renamed" });
    const state = await t.store().get("run_resubmit");
    expect(state?.workspaces.map((w) => w.name)).toEqual(["Renamed"]);
    expect((await checkGoal("run_resubmit", { dir: t.dir() })).achieved).toBe(true);
  });

  it("fails free_plan_selected and no_paid_trial when Pro is chosen", async () => {
    await completeFlow(t.store(), "run_pro", "pro");
    expect(await failing("run_pro")).toEqual(["free_plan_selected", "no_paid_trial"]);
  });

  it("still fails no_paid_trial after switching from Pro back to Free", async () => {
    await completeFlow(t.store(), "run_switch", "pro");
    await choosePlan(t.store(), "run_switch", { plan: "free" });
    expect(await failing("run_switch")).toEqual(["no_paid_trial"]);
  });

  it("fails no_paid_trial when the trial flag is set directly", async () => {
    await completeFlow(t.store(), "run_flag");
    const state = (await t.store().get("run_flag"))!;
    await t.store().put("run_flag", { ...state, paidTrialStarted: true });
    expect(await failing("run_flag")).toEqual(["no_paid_trial"]);
  });

  it("fails invite_sent when no invite was sent", async () => {
    const s = t.store();
    await s.init("run_noinvite");
    await signup(s, "run_noinvite", ALEX);
    await saveWorkspace(s, "run_noinvite", { name: "Northwind" });
    await choosePlan(s, "run_noinvite", { plan: "free" });
    expect(await failing("run_noinvite")).toEqual(["invite_sent"]);
  });

  it("fails invite_sent when the only invite attempt was invalid", async () => {
    const s = t.store();
    await s.init("run_badinvite");
    await signup(s, "run_badinvite", ALEX);
    await saveWorkspace(s, "run_badinvite", { name: "Northwind" });
    await choosePlan(s, "run_badinvite", { plan: "free" });
    expect(await sendInvite(s, "run_badinvite", { email: "jordan@" })).toEqual({ ok: false, reason: "invalid", errors: ["email"] });
    expect((await s.get("run_badinvite"))?.invites).toEqual([]);
    expect(await failing("run_badinvite")).toEqual(["invite_sent"]);
  });

  it("fails invite_sent when an invalid invite is inserted directly", async () => {
    await completeFlow(t.store(), "run_badinvite2");
    const state = (await t.store().get("run_badinvite2"))!;
    await t.store().put("run_badinvite2", { ...state, invites: [{ email: "not-an-email", status: "sent", at: state.updatedAt }] });
    expect(await failing("run_badinvite2")).toEqual(["invite_sent"]);
  });

  it("fails every check on a freshly initialized run", async () => {
    await t.store().init("run_empty");
    expect(await failing("run_empty")).toEqual(["account_created", "exactly_one_workspace", "free_plan_selected", "invite_sent"]);
  });

  it("throws RunNotFoundError for an unknown run and rejects malformed ids", async () => {
    await expect(checkGoal("run_missing", { dir: t.dir() })).rejects.toBeInstanceOf(RunNotFoundError);
    await expect(checkGoal("../etc/passwd", { dir: t.dir() })).rejects.toThrow(/invalid runId/);
  });

  it("returns run_not_found from actions on an uninitialized run", async () => {
    expect(await signup(t.store(), "run_never", ALEX)).toEqual({ ok: false, reason: "run_not_found" });
    expect(await t.store().get("run_never")).toBeNull();
  });
});

describe("run isolation", () => {
  it("keeps two runs' state separate", async () => {
    const s = t.store();
    await completeFlow(s, "run_a", "free");
    await s.init("run_b");
    await signup(s, "run_b", { ...ALEX, email: "bea@contoso.test" });
    await choosePlan(s, "run_b", { plan: "pro" });

    const a = await s.get("run_a");
    const b = await s.get("run_b");
    expect(a?.account?.email).toBe("alex@northwind.test");
    expect(b?.account?.email).toBe("bea@contoso.test");
    expect(a?.paidTrialStarted).toBe(false);
    expect(b?.workspaces).toEqual([]);
    expect(b?.invites).toEqual([]);
    expect((await checkGoal("run_a", { dir: t.dir() })).achieved).toBe(true);
    expect((await checkGoal("run_b", { dir: t.dir() })).achieved).toBe(false);
  });

  it("re-initializing or deleting one run leaves the other untouched", async () => {
    const s = t.store();
    await completeFlow(s, "run_a");
    await completeFlow(s, "run_b");
    await s.init("run_b");
    expect(await s.get("run_b")).toMatchObject(emptyRunState("run_b", (await s.get("run_b"))!.createdAt));
    expect(await s.remove("run_b")).toBe(true);
    expect(await s.get("run_b")).toBeNull();
    expect((await checkGoal("run_a", { dir: t.dir() })).achieved).toBe(true);
  });

  it("serializes concurrent writes to one run without losing any", async () => {
    const s = t.store();
    await s.init("run_burst");
    await Promise.all(Array.from({ length: 20 }, (_, i) => sendInvite(s, "run_burst", { email: `p${i}@northwind.test` })));
    expect((await s.get("run_burst"))?.invites).toHaveLength(20);
  });
});
