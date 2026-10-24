import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { choosePlan, saveWorkspace, sendInvite, signup, type ActionResult } from "./actions";
import { PlanChoice, type RunState } from "./state";
import { createRunStore, defaultRunsDir } from "./store";
import { isRunId } from "./validation";

const MAX_BODY_BYTES = 16 * 1024;
const ROUTE = /^\/api\/runs\/([^/]+)(?:\/(init|state|signup|workspace|plan|invite))?\/?$/;

const bodies = {
  signup: z.object({ name: z.string(), email: z.string(), password: z.string(), consent: z.boolean() }),
  workspace: z.object({ name: z.string() }),
  plan: z.object({ plan: PlanChoice }),
  invite: z.object({ email: z.string() }),
};

type Step = keyof typeof bodies;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body?: unknown) {
  res.statusCode = status;
  res.setHeader("Cache-Control", "no-store");
  if (body === undefined) return void res.end();
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "body too large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
  } catch {
    throw new HttpError(400, "body must be JSON");
  }
}

export interface RunsApiOptions {
  dir?: string;
}

// Connect-style middleware for /api/runs/... Mount it without a path prefix; other URLs fall through to next().
export function createRunsApi(options: RunsApiOptions = {}) {
  const store = createRunStore(options.dir ?? defaultRunsDir());

  const act = (step: Step, runId: string, body: unknown): Promise<ActionResult<string>> => {
    const parsed = bodies[step].safeParse(body);
    if (!parsed.success) throw new HttpError(400, `invalid ${step} body: ${parsed.error.issues.map((i) => `${i.path.join(".") || "body"} ${i.message}`).join("; ")}`);
    switch (step) {
      case "signup":
        return signup(store, runId, parsed.data as z.infer<typeof bodies.signup>);
      case "workspace":
        return saveWorkspace(store, runId, parsed.data as z.infer<typeof bodies.workspace>);
      case "plan":
        return choosePlan(store, runId, parsed.data as z.infer<typeof bodies.plan>);
      case "invite":
        return sendInvite(store, runId, parsed.data as z.infer<typeof bodies.invite>);
    }
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const match = ROUTE.exec((req.url ?? "").split("?")[0] ?? "");
    if (!match) return false;
    const runId = decodeURIComponent(match[1] ?? "");
    const step = match[2];
    const method = req.method ?? "GET";
    if (!isRunId(runId)) throw new HttpError(400, "runId must match ^run_[A-Za-z0-9_-]+$");

    const notFound = () => send(res, 404, { error: "run_not_found" });
    const respond = (state: RunState | null, status = 200) => (state ? send(res, status, state) : notFound());

    if (step === undefined && method === "DELETE") {
      if (await store.remove(runId)) send(res, 204);
      else notFound();
    } else if (step === "init" && method === "POST") {
      respond(await store.init(runId), 201);
    } else if (step === "state" && method === "GET") {
      respond(await store.get(runId));
    } else if (step !== undefined && step in bodies && method === "POST") {
      const result = await act(step as Step, runId, await readJson(req));
      if (result.ok) respond(result.state);
      else if (result.reason === "invalid") send(res, 422, { errors: result.errors });
      else notFound();
    } else {
      throw new HttpError(405, `${method} not allowed here`);
    }
    return true;
  };

  return (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
    handle(req, res).then(
      (handled) => {
        if (!handled) next();
      },
      (err: unknown) => {
        if (err instanceof HttpError) send(res, err.status, { error: err.message });
        else next(err);
      },
    );
  };
}
