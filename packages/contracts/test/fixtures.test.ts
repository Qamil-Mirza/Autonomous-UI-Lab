import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";
import { FIXTURE_SCHEMAS, loadFixture } from "../fixtures";
import { BatchResult } from "../src/simulation";
import { ExperimentProtocol } from "../src/protocol";
import { DesignManifest } from "../src/manifest";
import { Evaluation } from "../src/evaluation";
import { DesignFeedbackPacket } from "../src/analysis";
import { Approval } from "../src/experiment";
import type { AgentRunResult } from "../src/agent";

const FIXTURES_DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));

function walkJson(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkJson(full));
    else if (name.endsWith(".json")) out.push(relative(FIXTURES_DIR, full).split(sep).join("/"));
  }
  return out;
}

function rawJson(relPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, relPath), "utf8")) as Record<string, unknown>;
}

const batch = (p: string) => loadFixture(p, BatchResult);
const protocol = loadFixture("protocol.default.json", ExperimentProtocol);
const scenarioIds = protocol.scenarios.map((s) => s.id);
const steps = (r: AgentRunResult) => r.events.filter((e) => e.action.type !== "stop").length;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const revisitsScreen = (r: AgentRunResult, screen: string) => {
  let left = false;
  for (const e of r.events) {
    if (left && e.screenBefore === screen) return true;
    if (e.screenBefore === screen && e.screenAfter !== screen) left = true;
  }
  return false;
};
const hasValidationError = (r: AgentRunResult) => r.events.some((e) => e.result === "validation_error");
const count = (b: BatchResult, o: string) => b.runs.filter((r) => r.outcome === o).length;

const BATCHES = [
  "batch.metrics-4-4-2-1.json", "batch.baseline.json", "batch.candidate-improved.json",
  "batch.candidate-flat.json", "batch.zero-valid.json", "batch.underfilled.json",
];

describe("fixture registry", () => {
  it.each(Object.entries(FIXTURE_SCHEMAS))("%s parses", (path, schema) => {
    const f = loadFixture(path, schema) as { provenance?: string };
    expect(f).toBeTruthy();
    expect(f).not.toHaveProperty("provenance");
  });
  it("every json file is registered", () => {
    expect(walkJson(FIXTURES_DIR).sort()).toEqual(Object.keys(FIXTURE_SCHEMAS).sort());
  });
  it("every fixture is labeled synthetic", () => {
    for (const p of Object.keys(FIXTURE_SCHEMAS)) expect(rawJson(p).provenance).toBe("synthetic-fixture");
  });
  it("loadFixture rejects a fixture whose provenance is not synthetic-fixture", () => {
    expect(() => loadFixture("../package.json", ExperimentProtocol)).toThrow(/provenance/);
  });
});

describe("batch fixture invariants", () => {
  it.each(BATCHES)("%s: shared ids, known scenarios, contiguous seq, screenshot refs", (p) => {
    const b = batch(p);
    for (const r of b.runs) {
      expect(r.batchId).toBe(b.batchId);
      expect(r.versionId).toBe(b.versionId);
      expect(r.protocolId).toBe(protocol.id);
      expect(r.experimentId).toBe(protocol.experimentId);
      expect(scenarioIds).toContain(r.scenarioId);
      expect(r.events.map((e) => e.seq)).toEqual(r.events.map((_, i) => i));
      expect(r.stepCount).toBe(steps(r));
      expect(r.stepCount).toBeLessThanOrEqual(protocol.budgets.maxActionsPerRun);
      for (const e of r.events) {
        expect(e.versionId).toBe(b.versionId);
        expect(e.screenshot).toEqual({ uri: `artifacts/${r.runId}/${e.seq}.png`, width: 1280, height: 800 });
      }
    }
    expect(new Set(b.runs.map((r) => r.runId)).size).toBe(b.runs.length);
    expect(b.runs.some((r) => r.events.some((e) => e.pointer === undefined))).toBe(true);
  });

  it("metrics-4-4-2-1: 11 runs of 12 planned, 4 goal / 4 behavioral failure / 2 infra / 1 cancelled", () => {
    const b = batch("batch.metrics-4-4-2-1.json");
    expect(b.plannedRuns).toBe(12);
    expect(b.runs).toHaveLength(11);
    expect(count(b, "goal")).toBe(4);
    expect(b.runs.filter((r) => r.behaviorallyValid)).toHaveLength(8);
    expect(count(b, "agent_stop") + count(b, "step_limit") + count(b, "flow_blocked")).toBe(4);
    for (const o of ["agent_stop", "step_limit", "flow_blocked"]) expect(count(b, o)).toBeGreaterThan(0);
    expect(count(b, "model_error")).toBe(1);
    expect(count(b, "browser_error")).toBe(1);
    expect(count(b, "user_cancelled")).toBe(1);
  });

  it("baseline: 12 valid runs, 6 goal, 5 revisit plan, no other screen revisited by 5+, 1 invite.email validation error", () => {
    const b = batch("batch.baseline.json");
    expect(b.runs).toHaveLength(12);
    expect(b.runs.every((r) => r.behaviorallyValid)).toBe(true);
    expect(count(b, "goal")).toBe(6);
    expect(b.runs.filter((r) => revisitsScreen(r, "plan"))).toHaveLength(5);
    for (const s of ["signup", "workspace", "invite", "done", "compare"]) {
      expect(b.runs.filter((r) => revisitsScreen(r, s)).length).toBeLessThan(5);
    }
    const ve = b.runs.filter(hasValidationError);
    expect(ve).toHaveLength(1);
    expect(ve[0]!.events.find((e) => e.result === "validation_error")!.action.elementId).toBe("invite.email");
    expect(b.runs.filter((r) => r.outcome === "goal").map(steps).sort()).toEqual([6, 7, 7, 8, 8, 8]);
  });

  it.each([
    ["batch.candidate-improved.json", 9],
    ["batch.candidate-flat.json", 7],
  ] as const)("%s: %i goals of 12, secondary metrics within guardrails of baseline", (p, goals) => {
    const base = batch("batch.baseline.json");
    const b = batch(p);
    expect(b.runs).toHaveLength(12);
    expect(b.runs.every((r) => r.behaviorallyValid)).toBe(true);
    expect(count(b, "goal")).toBe(goals);
    const goalSteps = (x: BatchResult) => x.runs.filter((r) => r.outcome === "goal").map(steps);
    expect(median(goalSteps(b))).toBeLessThanOrEqual(median(goalSteps(base)) + 2);
    const veRate = (x: BatchResult) => x.runs.filter(hasValidationError).length / x.runs.length;
    expect(veRate(b) * 100).toBeLessThanOrEqual(veRate(base) * 100 + 15);
  });

  it.each(["batch.metrics-4-4-2-1.json", "batch.baseline.json", "batch.candidate-improved.json", "batch.candidate-flat.json"])(
    "%s: every scenario has at least one valid run",
    (p) => {
      const b = batch(p);
      for (const id of scenarioIds) expect(b.runs.some((r) => r.scenarioId === id && r.behaviorallyValid)).toBe(true);
    },
  );

  it("zero-valid: 12 runs, all infra errors", () => {
    const b = batch("batch.zero-valid.json");
    expect(b.runs).toHaveLength(12);
    expect(b.runs.every((r) => r.outcome === "model_error" || r.outcome === "browser_error")).toBe(true);
  });

  it("underfilled: 6 valid runs of 12 planned (below ceil(0.75 x 12) = 9)", () => {
    const b = batch("batch.underfilled.json");
    expect(b.plannedRuns).toBe(12);
    expect(b.runs.filter((r) => r.behaviorallyValid)).toHaveLength(6);
  });
});

describe("other fixture content", () => {
  it("protocol.default follows R3", () => {
    expect(protocol.policy.targetCompletionRate).toBe(0.8);
    expect(protocol.budgets).toMatchObject({ maxIterations: 3, maxCandidates: 3, maxInferenceUsd: 5, maxWallClockMs: 1800000, maxActionsPerRun: 8 });
    expect(protocol.mode).toBe("manual");
    expect(protocol.scenarios).toHaveLength(4);
    expect(protocol.scenarios.every((s) => s.runs === 3)).toBe(true);
    expect([...protocol.protectedCategories].sort()).toEqual(["auth", "checker", "consent", "pricing", "signup", "validation"]);
    expect(protocol.approvedStyleTokens).toEqual(["button.primary", "button.secondary", "emphasis.strong"]);
    expect(protocol.protectedElements).toEqual(expect.arrayContaining(["plan.free.price", "plan.pro.price", "invite.email"]));
  });

  it("manifest.base matches the current prototype handoff", () => {
    const m = loadFixture("manifest.base.json", DesignManifest);
    expect(m.elements.map((e) => e.elementId).sort()).toEqual([
      "confirm.done", "confirm.title", "invite.email", "invite.error", "invite.send", "plan.free.cta", "plan.free.note", "plan.free.price",
      "plan.pro.cta", "plan.pro.price", "signup.consent", "signup.email", "signup.name", "signup.password", "signup.submit",
      "workspace.continue", "workspace.name",
    ]);
    const el = (id: string) => m.elements.find((e) => e.elementId === id)!;
    expect(el("plan.free.cta").supportedOps).toEqual(["set_label", "set_style_token"]);
    expect(el("plan.free.note").supportedOps).toEqual(["set_visibility", "set_label"]);
    expect(el("plan.pro.price")).toMatchObject({ protected: true, categories: ["pricing"] });
    expect(m.versionId).toBe("ver_baseline");
    expect(el("plan.free.note")).toMatchObject({ label: "No card required", role: "text", visible: false });
    expect(el("plan.free.cta").label).toBe("Continue");
    expect(el("plan.pro.cta").label).toBe("Start free trial");
    expect(el("plan.pro.price").label).toBe("$12 / user / month");
    expect(el("invite.send").label).toBe("Send invite");
    expect(el("invite.email")).toMatchObject({ protected: true, categories: ["validation"] });
  });

  it("feedback-packet has 2+ unblocked patches and a blocked plan.pro.price set_label; approval approves a subset", () => {
    const pkt = loadFixture("feedback-packet.json", DesignFeedbackPacket);
    expect(pkt.patches.filter((p) => p.state !== "blocked").length).toBeGreaterThanOrEqual(2);
    const blocked = pkt.patches.filter((p) => p.state === "blocked");
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({ targetElementId: "plan.pro.price", op: "set_label", risk: "blocked" });
    const appr = loadFixture("approval.partial.json", Approval);
    const unblocked = pkt.patches.filter((p) => p.state !== "blocked").map((p) => p.id);
    expect(appr.patchIds.every((id) => unblocked.includes(id))).toBe(true);
    expect(appr.patchIds.length).toBeLessThan(unblocked.length);
  });

  it("evaluations carry the expected decisions and deltas", () => {
    const acc = loadFixture("evaluation.accepted.json", Evaluation);
    const rej = loadFixture("evaluation.rejected.json", Evaluation);
    const inc = loadFixture("evaluation.inconclusive.json", Evaluation);
    expect(acc).toMatchObject({ decision: "accepted" });
    expect(acc.deltaPp).toBe(25);
    expect(rej).toMatchObject({ decision: "rejected", candidate: null, deltaPp: null });
    expect(rej.guardrails.some((g) => !g.passed)).toBe(true);
    expect(inc).toMatchObject({ decision: "inconclusive" });
    expect(inc.deltaPp).toBe(8.3);
    const base = batch("batch.baseline.json");
    expect(acc.baseline).toMatchObject({ batchId: base.batchId, successes: 6, validRuns: 12, completionRate: 0.5, medianActionsToSuccess: 7.5, backtrackRuns: 5, validationErrorRuns: 1 });
    expect(acc.candidate).toMatchObject({ batchId: batch("batch.candidate-improved.json").batchId, successes: 9, completionRate: 0.75 });
    expect(inc.candidate).toMatchObject({ batchId: batch("batch.candidate-flat.json").batchId, successes: 7 });
  });
});
