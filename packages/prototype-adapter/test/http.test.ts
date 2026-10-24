import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkGoal, createRunsApi, RunNotFoundError } from "../src";
import { ALEX, useTempStore } from "./helpers";

const t = useTempStore();
let server: Server;
let baseUrl = "";

beforeEach(async () => {
  const api = createRunsApi({ dir: t.dir() });
  server = createServer((req, res) =>
    api(req, res, (err) => {
      res.statusCode = err ? 500 : 404;
      res.end();
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const post = (path: string, body?: unknown) =>
  fetch(baseUrl + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

describe("runs API", () => {
  it("drives a full run and matches the direct checkGoal", async () => {
    const init = await post("/api/runs/run_http/init");
    expect(init.status).toBe(201);
    expect(init.headers.get("cache-control")).toBe("no-store");
    expect((await post("/api/runs/run_http/signup", ALEX)).status).toBe(200);
    expect((await post("/api/runs/run_http/workspace", { name: "Northwind Sales" })).status).toBe(200);
    expect((await post("/api/runs/run_http/plan", { plan: "free" })).status).toBe(200);
    const invite = await post("/api/runs/run_http/invite", { email: "jordan@northwind.test" });
    expect(invite.status).toBe(200);
    expect((await invite.json()).invites).toHaveLength(1);

    const state = await fetch(`${baseUrl}/api/runs/run_http/state`);
    expect(state.status).toBe(200);
    expect((await state.json()).account.email).toBe("alex@northwind.test");

    const viaHttp = await checkGoal("run_http", { baseUrl });
    const direct = await checkGoal("run_http", { dir: t.dir() });
    expect(viaHttp.achieved).toBe(true);
    expect(viaHttp.checks).toEqual(direct.checks);
  });

  it("returns 422 with field errors and persists nothing for invalid input", async () => {
    await post("/api/runs/run_422/init");
    const signup = await post("/api/runs/run_422/signup", { name: "", email: "x", password: "short", consent: false });
    expect(signup.status).toBe(422);
    expect(await signup.json()).toEqual({ errors: ["name", "email", "password", "consent"] });
    const invite = await post("/api/runs/run_422/invite", { email: "jordan@" });
    expect(invite.status).toBe(422);
    expect(await invite.json()).toEqual({ errors: ["email"] });
    const state = await (await fetch(`${baseUrl}/api/runs/run_422/state`)).json();
    expect(state.account).toBeNull();
    expect(state.invites).toEqual([]);
  });

  it("returns 404 for runs that were never initialized", async () => {
    expect((await fetch(`${baseUrl}/api/runs/run_nope/state`)).status).toBe(404);
    expect((await post("/api/runs/run_nope/plan", { plan: "free" })).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/runs/run_nope`, { method: "DELETE" })).status).toBe(404);
    await expect(checkGoal("run_nope", { baseUrl })).rejects.toBeInstanceOf(RunNotFoundError);
  });

  it("deletes a run", async () => {
    await post("/api/runs/run_del/init");
    expect((await fetch(`${baseUrl}/api/runs/run_del`, { method: "DELETE" })).status).toBe(204);
    expect((await fetch(`${baseUrl}/api/runs/run_del/state`)).status).toBe(404);
  });

  it("rejects bad run ids and malformed bodies with 400", async () => {
    expect((await post("/api/runs/exp_1/init")).status).toBe(400);
    expect((await post("/api/runs/run_a.b/init")).status).toBe(400);
    expect((await post("/api/runs/..%2F..%2Fetc/init")).status).toBe(400);
    await post("/api/runs/run_body/init");
    expect((await post("/api/runs/run_body/signup", "{not json")).status).toBe(400);
    expect((await post("/api/runs/run_body/plan", { plan: "enterprise" })).status).toBe(400);
    expect((await post("/api/runs/run_body/signup", { name: "Alex" })).status).toBe(400);
    expect((await post("/api/runs/run_body/invite", { email: "x".repeat(20_000) })).status).toBe(413);
  });

  it("rejects wrong methods and passes unrelated URLs through", async () => {
    expect((await fetch(`${baseUrl}/api/runs/run_m/init`)).status).toBe(405);
    expect((await fetch(`${baseUrl}/somewhere/else`)).status).toBe(404);
  });
});
