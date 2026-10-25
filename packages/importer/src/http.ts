import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import { ImportError, errorInfo, type ImportErrorCode } from "./errors";
import type { ImportService, StartExperimentOptions } from "./service";
import { CHECK_CAVEAT, JUDGED_CAVEAT, describeCheck, isJudgedTask, type ImportTaskDraft } from "./task";
import { DEFAULT_ZIP_LIMITS } from "./zip";

const STATUS: Partial<Record<ImportErrorCode | "INTERNAL", number>> = {
  NOT_FOUND: 404,
  INVALID_TASK: 400,
  INVALID_STATE: 409,
  RUNTIME_UNAVAILABLE: 503,
  ARCHIVE_TOO_LARGE: 413,
  PATCH_REJECTED: 422,
};

export const DEFAULT_IMPORT_PORT = 5180;
export const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:5174", "http://127.0.0.1:5174"];

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(json);
}

function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] ?? "0");
    if (declared > max) {
      reject(new HttpError(413, `The upload is larger than ${Math.round(max / 1024 / 1024)} MB.`));
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(new HttpError(413, `The upload is larger than ${Math.round(max / 1024 / 1024)} MB.`));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function json(req: IncomingMessage): Promise<unknown> {
  if (!(req.headers["content-type"] ?? "").startsWith("application/json")) throw new HttpError(415, "Send JSON (Content-Type: application/json).");
  const body = await readBody(req, 256 * 1024);
  try {
    return body.length ? JSON.parse(body.toString("utf8")) : {};
  } catch {
    throw new HttpError(400, "The body is not valid JSON.");
  }
}

/** The import record plus what the dashboard derives from it (live preview URL, check descriptions). */
async function view(service: ImportService, id: string) {
  const rec = await service.get(id);
  const base = rec.baseVersionId ? await service.store.getVersion(rec.baseVersionId) : undefined;
  const build = rec.baseVersionId ? await service.store.getBuild(rec.baseVersionId) : undefined;
  return {
    ...rec,
    preview: base && build?.status === "ready" ? { versionId: base.versionId, url: service.previewUrl(base) } : undefined,
    checkDescriptions: rec.task?.successChecks.map(describeCheck) ?? [],
    checkCaveat: CHECK_CAVEAT,
    judgedCaveat: JUDGED_CAVEAT,
    judged: rec.task ? isJudgedTask(rec.task) : undefined,
    editable: base ? { total: base.manifest.elements.length, editable: base.manifest.elements.filter((e) => e.supportedOps.length).length } : undefined,
  };
}

/**
 * HTTP API for the import workflow, served by the worker on loopback only. Requests carrying an `Origin` header
 * must come from the dashboard (so previews and other pages in the designer's browser cannot drive it); JSON
 * bodies require a JSON content type (forcing a CORS preflight, which this server never grants).
 */
export function importApiHandler(service: ImportService, opts: { allowedOrigins?: string[]; artifactsDir?: string } = {}) {
  const allowed = new Set(opts.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS);
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const origin = req.headers.origin;
      if (origin && !allowed.has(origin)) throw new HttpError(403, `Requests from ${origin} are not allowed.`);
      if (req.method === "OPTIONS") throw new HttpError(403, "Cross-origin requests are not allowed.");
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      const method = req.method ?? "GET";

      // /api/import-runtime
      if (parts[0] === "api" && parts[1] === "import-runtime" && method === "GET") return send(res, 200, await service.runtimeStatus());

      // /api/import-versions/:versionId[/preview]
      if (parts[0] === "api" && parts[1] === "import-versions" && parts[2]) {
        const versionId = parts[2];
        if (parts.length === 3 && method === "GET") return send(res, 200, await service.versionView(versionId));
        if (parts[3] === "preview" && method === "POST") return send(res, 200, { url: await service.ensurePreview(versionId) });
        throw new HttpError(404, "Not found.");
      }

      if (parts[0] !== "api" || parts[1] !== "imports") throw new HttpError(404, "Not found.");
      const id = parts[2];
      const action = parts[3];

      if (!id) {
        if (method === "GET") {
          const list = await service.list();
          return send(res, 200, { imports: await Promise.all(list.map((r) => view(service, r.id))), runtime: await service.runtimeStatus() });
        }
        if (method === "POST") {
          const type = req.headers["content-type"] ?? "";
          if (!type.startsWith("application/zip") && !type.startsWith("application/octet-stream") && !type.startsWith("application/x-zip-compressed")) {
            throw new HttpError(415, "Upload the code ZIP as the request body (Content-Type: application/zip).");
          }
          const zip = await readBody(req, DEFAULT_ZIP_LIMITS.maxArchiveBytes);
          const name = url.searchParams.get("name") ?? "";
          const figmaUrl = url.searchParams.get("figmaUrl") ?? undefined;
          const fileName = url.searchParams.get("fileName") ?? undefined;
          const rec = await service.createImport({ name, ...(figmaUrl ? { figmaUrl } : {}), ...(fileName ? { fileName } : {}), zip });
          return send(res, 202, await view(service, rec.id));
        }
        throw new HttpError(405, "Method not allowed.");
      }

      if (!action && method === "GET") return send(res, 200, await view(service, id));
      if (action === "cancel" && method === "POST") return send(res, 200, (await service.cancel(id), await view(service, id)));
      if (action === "retry" && method === "POST") return send(res, 200, (await service.retry(id), await view(service, id)));
      if (action === "task" && method === "PUT") return send(res, 200, (await service.saveTask(id, (await json(req)) as ImportTaskDraft), await view(service, id)));
      if (action === "suggest-checks" && method === "POST") {
        return send(res, 200, await service.suggestChecks(id, (await json(req)) as { task: string; startRoute: string; viewport: { width: number; height: number } }));
      }
      if (action === "verify" && method === "POST") return send(res, 200, (await service.verify(id), await view(service, id)));
      if (action === "freeze" && method === "POST") return send(res, 200, (await service.freeze(id), await view(service, id)));
      if (action === "experiments" && method === "POST") return send(res, 201, await service.startExperiment(id, (await json(req)) as StartExperimentOptions));
      if (action === "log" && method === "GET") {
        const rec = await service.get(id);
        const step = url.searchParams.get("step") === "install" ? "install" : "build";
        const versionId = url.searchParams.get("version") ?? rec.baseVersionId;
        if (!versionId || !/^ver_imp_[0-9a-f]{12}$/.test(versionId)) throw new HttpError(404, "No build log yet.");
        const file = path.join(service.store.dir.build(versionId), `${step}.log`);
        const s = await stat(file).catch(() => undefined);
        if (!s) throw new HttpError(404, "No build log yet.");
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
        createReadStream(file, { start: Math.max(0, s.size - 200_000) }).pipe(res);
        return;
      }
      throw new HttpError(404, "Not found.");
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: { code: "HTTP", message: err.message } });
      const info = errorInfo(err);
      const status = STATUS[info.code] ?? (err instanceof ImportError ? 422 : 500);
      return send(res, status, { error: info });
    }
  };
}

export function startImportApi(service: ImportService, opts: { port?: number; host?: string; allowedOrigins?: string[] } = {}): Promise<Server> {
  const server = createServer((req, res) => void importApiHandler(service, opts)(req, res));
  // Uploads can take a while on a slow link; the build itself runs in the background.
  server.requestTimeout = 5 * 60_000;
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? DEFAULT_IMPORT_PORT, opts.host ?? "127.0.0.1", () => resolve(server));
  });
}
