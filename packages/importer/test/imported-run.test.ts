import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSimulationAdapter, runOne, type Decider } from "@ghostloop/simulator";
import { importedIntegration, previewRequestPolicy } from "../src/integration";
import { FrozenTask, ImportTask } from "../src/task";

// A small ID-less single-page app: no data-testid, no screen markers, history routing and localStorage state,
// the shapes a Figma Make export has. Served statically, like a preview container.
const APP = `<!doctype html><html><head><title>Shop</title></head><body><div id="root"></div><script>
var root = document.getElementById('root');
function bag() { return JSON.parse(localStorage.getItem('bag') || '[]'); }
function go(p) { history.pushState({}, '', p); render(); }
function render() {
  var p = location.pathname;
  if (p === '/') root.innerHTML = '<h1>Menu</h1><p>Items in bag: ' + bag().length + '</p><button id="add">Add flat white</button> <a href="/bag" id="bag">Go to bag</a> <a href="https://example.org/" id="ext">Partner site</a>';
  else if (p === '/bag') root.innerHTML = '<h1>Your bag</h1><p>' + bag().length + ' items</p><label>Email <input id="email" type="email"></label><button id="pay">Proceed</button>';
  else if (p === '/done') root.innerHTML = '<h1>Order confirmed</h1>';
  var add = document.getElementById('add'); if (add) add.onclick = function () { localStorage.setItem('bag', JSON.stringify(bag().concat(['fw']))); render(); };
  var bagLink = document.getElementById('bag'); if (bagLink) bagLink.onclick = function (e) { e.preventDefault(); go('/bag'); };
  var pay = document.getElementById('pay'); if (pay) pay.onclick = function () {
    var ok = /@/.test(document.getElementById('email').value) && bag().length > 0;
    if (ok) go('/done'); else { var m = document.createElement('p'); m.setAttribute('role', 'alert'); m.textContent = 'Enter an email and add an item.'; root.appendChild(m); }
  };
}
window.onpopstate = render; render();
</script></body></html>`;

let server: Server;
let origin = "";
let dir = "";
const requests: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    requests.push(req.url ?? "");
    res.writeHead(200, { "Content-Type": "text/html" }).end(APP);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("no address");
  origin = `http://127.0.0.1:${a.port}`;
  dir = await mkdtemp(path.join(tmpdir(), "gl-imported-run-"));
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await rm(dir, { recursive: true, force: true });
});

const frozen = (over: Partial<ImportTask> = {}) =>
  FrozenTask.parse({
    schemaVersion: "1.0.0",
    importId: "imp_aaaaaaaaaaaa",
    baseVersionId: "ver_imp_aaaaaaaaaaaa",
    task: ImportTask.parse({
      task: "Add a flat white to your bag and place the order.",
      startRoute: "/",
      viewport: { width: 1024, height: 700 },
      successChecks: [{ kind: "route", path: "/done" }, { kind: "text", text: "Order confirmed" }],
      inputs: { email: "pat@example.com" },
      ...over,
    }),
    frozenAt: new Date().toISOString(),
  });

/** Scripted decisions (no model): each picks a control by its discovered label. */
function scripted(steps: ({ type: "click" | "type" | "stop"; label?: string; value?: string; reason?: string })[], seen: string[][] = []): Decider {
  let i = 0;
  return async (input, controls) => {
    seen.push(controls.map((c) => c.elementId));
    const s = steps[Math.min(i++, steps.length - 1)]!;
    if (s.type === "stop") return { type: "stop", reason: s.reason ?? "done" };
    const c = controls.find((x) => x.label === s.label);
    if (!c) return { type: "stop", reason: `no control labeled ${s.label}` };
    const reason = "scripted test step";
    return s.type === "type" ? { type: "type", elementId: c.elementId, value: s.value ?? "", reason } : { type: "click", elementId: c.elementId, reason };
  };
}

const integration = (f = frozen()) => importedIntegration({ versionId: "ver_imp_aaaaaaaaaaaa", origin, frozen: f });

describe("imported-app run (real browser, scripted decisions)", () => {
  it("discovers controls without test IDs and verifies success only with the frozen checks", async () => {
    const seen: string[][] = [];
    const result = await runOne({
      url: origin, outputDir: dir, signal: new AbortController().signal, provenance: "mock-decisions", maxActions: 8,
      task: frozen().task.task, prototype: integration(),
      decide: scripted([{ type: "click", label: "Add flat white" }, { type: "click", label: "Go to bag" }, { type: "type", label: "Email", value: "pat@example.com" }, { type: "click", label: "Proceed" }], seen),
    });
    expect(seen[0]).toEqual(expect.arrayContaining(["button.add-flat-white", "link.go-to-bag"]));
    expect(result.outcome).toBe("goal");
    expect(result.goalVerified).toBe(true);
    expect(result.stepCount).toBe(4);
    expect(result.terminalScreen).toBe("/done · Order confirmed");
    const evidence = JSON.parse(result.goalEvidence!);
    expect(evidence.checks.map((c: { name: string; passed: boolean }) => [c.name, c.passed])).toEqual([["route is /done", true], ['text contains "Order confirmed"', true]]);
    // Frozen viewport is applied.
    expect(result.events[0]!.viewport).toEqual({ width: 1024, height: 700 });
    const png = await readFile(result.screenshots[0]!.uri);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1024, 700]);
  }, 60_000);

  it("does not count the model's own claim of success", async () => {
    const result = await runOne({
      url: origin, outputDir: dir, signal: new AbortController().signal, provenance: "mock-decisions", maxActions: 3,
      task: frozen().task.task, prototype: integration(),
      decide: scripted([{ type: "stop", reason: "The order is complete and confirmed." }]),
    });
    expect(result.outcome).toBe("agent_stop");
    expect(result.goalVerified).toBe(false);
  }, 60_000);

  it("records UI validation errors as behavior, not success", async () => {
    const result = await runOne({
      url: origin, outputDir: dir, signal: new AbortController().signal, provenance: "mock-decisions", maxActions: 2,
      task: frozen().task.task, prototype: integration(),
      decide: scripted([{ type: "click", label: "Go to bag" }, { type: "click", label: "Proceed" }]),
    });
    expect(result.outcome).toBe("step_limit");
    expect(result.events[1]!.result).toBe("validation_error");
    expect(result.events[1]!.validationFeedback).toEqual(["Enter an email and add an item."]);
  }, 60_000);

  it("gives every run fresh application state", async () => {
    const first = await runOne({
      url: origin, outputDir: dir, signal: new AbortController().signal, provenance: "mock-decisions", maxActions: 1,
      task: frozen().task.task, prototype: integration(), decide: scripted([{ type: "click", label: "Add flat white" }]),
    });
    expect(first.events[0]!.result).toBe("ok");
    const obs = JSON.parse(await readFile(`${first.screenshots[1]!.uri}.observation.json`, "utf8"));
    expect(obs.controls.length).toBeGreaterThan(0);
    // The second run starts with an empty bag although the first one added to localStorage.
    const seen: string[][] = [];
    let text = "";
    await runOne({
      url: origin, outputDir: dir, signal: new AbortController().signal, provenance: "mock-decisions", maxActions: 1,
      task: frozen().task.task, prototype: { ...integration(), checkGoal: async (runId, page) => {
        text = await page!.evaluate("document.body.innerText") as string;
        return integration().checkGoal(runId, page);
      } },
      decide: scripted([{ type: "stop" }], seen),
    });
    expect(text).toContain("Items in bag: 0");
  }, 60_000);

  it("rejects navigation out of the preview before it happens", async () => {
    const result = await runOne({
      url: origin, outputDir: dir, signal: new AbortController().signal, provenance: "mock-decisions", maxActions: 1,
      task: frozen().task.task, prototype: integration(), decide: scripted([{ type: "click", label: "Partner site" }]),
    });
    // The decision is rejected three times (it never reaches the browser), so the run is a model error.
    expect(result.outcome).toBe("model_error");
    expect(result.events).toHaveLength(0);
  }, 60_000);

  it("runs a bounded batch through the integration factory", async () => {
    const adapter = createSimulationAdapter({
      outputDir: path.join(dir, "batches"), provenance: "mock-decisions",
      createDecider: () => scripted([{ type: "click", label: "Add flat white" }, { type: "click", label: "Go to bag" }, { type: "type", label: "Email", value: "pat@example.com" }, { type: "click", label: "Proceed" }]),
      integration: async () => integration(),
    });
    const events: unknown[] = [];
    const result = await adapter.runBatch({
      batchId: "batch_imported1", experimentId: "exp_imported1", protocolId: "proto_imported1", versionId: "ver_imp_aaaaaaaaaaaa",
      versionUrl: origin, task: frozen().task.task, hiddenGoalRef: "import-task:x", vetoRules: [],
      scenarios: [{ id: "scn_a", name: "A", description: "Careful.", inputs: { email: "pat@example.com" }, runs: 2 }],
      runsPerBatch: 2, maxActionsPerRun: 6, maxConcurrency: 2,
    }, (e) => void events.push(e), new AbortController().signal);
    expect(result.runs.map((r) => r.outcome)).toEqual(["goal", "goal"]);
    expect(new Set(result.runs.map((r) => r.runId)).size).toBe(2);
    expect(events).toHaveLength(8);
  }, 120_000);
});

describe("judged imported tasks (no page checks)", () => {
  const judgedTask = () => frozen({ successChecks: [] });
  const judge = (reached: boolean | "uncertain", seen: unknown[] = []) => ({
    info: { model: "test-judge", instructionVersion: "test-v1" },
    judge: async (input: unknown) => (seen.push(input), { verdict: { reached, explanation: "test verdict", evidence: ["seq 3"] }, usd: 0.01 }),
  });

  it("refuses to run without a judge, so page facts can never count as success", async () => {
    await expect(runOne({ url: origin, outputDir: dir, signal: new AbortController().signal, provenance: "mock-decisions", maxActions: 1,
      task: judgedTask().task.task, prototype: integration(judgedTask()), decide: scripted([{ type: "stop" }]) })).rejects.toThrow(/judged/);
    const adapter = createSimulationAdapter({ outputDir: path.join(dir, "batches-nojudge"), provenance: "mock-decisions", integration: async () => integration(judgedTask()) });
    await expect(adapter.runBatch({ batchId: "batch_nojudge1", experimentId: "exp_x", protocolId: "proto_x", versionId: "ver_imp_aaaaaaaaaaaa", versionUrl: origin,
      task: judgedTask().task.task, hiddenGoalRef: "import-task:x", scenarios: [{ id: "scn_a", name: "A", description: "", inputs: {}, runs: 1 }],
      runsPerBatch: 1, maxActionsPerRun: 2, maxConcurrency: 1 }, () => {}, new AbortController().signal)).rejects.toThrow(/needs a judge/);
  });

  it("lets only the judge's verdict decide, with the final page as evidence", async () => {
    const seen: { appState: { name: string; detail?: string }[] }[] = [];
    const steps = [{ type: "click" as const, label: "Add flat white" }, { type: "click" as const, label: "Go to bag" }, { type: "type" as const, label: "Email", value: "pat@example.com" }, { type: "click" as const, label: "Proceed" }, { type: "stop" as const, reason: "done" }];
    const reached = await runOne({ url: origin, outputDir: dir, signal: new AbortController().signal, provenance: "mock-decisions", maxActions: 6,
      task: judgedTask().task.task, prototype: integration(judgedTask()), decide: scripted(steps),
      judging: { judge: judge(true, seen as unknown[]), vetoRules: [] } });
    expect(reached.outcome).toBe("goal");
    expect(reached.judge).toMatchObject({ reached: true, model: "test-judge" });
    expect(seen[0]!.appState).toEqual([{ name: "final_page", passed: true, detail: expect.stringContaining("Page path /done") }]);
    // Same trial, judge says no: not a success, however the session ended.
    const notReached = await runOne({ url: origin, outputDir: dir, signal: new AbortController().signal, provenance: "mock-decisions", maxActions: 6,
      task: judgedTask().task.task, prototype: integration(judgedTask()), decide: scripted(steps), judging: { judge: judge(false), vetoRules: [] } });
    // It keeps how it ended (the confirmation page has no controls, so flow_blocked); never a goal.
    expect(notReached.outcome).toBe("flow_blocked");
    expect(notReached.goalVerified).toBe(false);
  }, 60_000);
});

describe("previewRequestPolicy", () => {
  const allow = previewRequestPolicy("http://127.0.0.1:47100");
  it("keeps navigation and scripts on the preview origin", () => {
    expect(allow("http://127.0.0.1:47100/checkout", true, "document")).toBe(true);
    expect(allow("https://evil.example/", true, "document")).toBe(false);
    expect(allow("https://cdn.example/x.js", false, "script")).toBe(false);
    expect(allow("https://api.example/order", false, "fetch")).toBe(false);
    expect(allow("https://fonts.gstatic.com/a.woff2", false, "font")).toBe(true);
    expect(allow("https://images.unsplash.com/a.jpg", false, "image")).toBe(true);
    expect(allow("http://user:pw@127.0.0.1:47100/", true, "document")).toBe(false);
  });
});
