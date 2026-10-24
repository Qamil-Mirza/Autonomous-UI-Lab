import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { VERSION_ID } from "./designs";

// Imports only node and ./designs so vite.config.ts can load it by relative path (see the note there). Mappings are
// schema-validated when figma:mapping writes them; here a file is only checked to be the mapping it claims to be.
const ROUTE = /^\/api\/figma\/([^/]+)\/?$/;

export interface FigmaApiOptions {
  designsDir: string;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

const exists = (file: string) => stat(file).then((s) => s.isFile(), () => false);

// GET /api/figma/:versionId → the version's Figma mapping, { versionId, status: "pending" } if none exists yet, or 404
// for an unknown version. Connect-style; other URLs fall through to next().
export function createFigmaApi(options: FigmaApiOptions) {
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const match = ROUTE.exec((req.url ?? "").split("?")[0] ?? "");
    if (!match) return false;
    const reply = (status: number, body: unknown) => (send(res, status, body), true);
    if ((req.method ?? "GET") !== "GET") return reply(405, { error: `${req.method} not allowed here` });
    const versionId = decodeURIComponent(match[1] ?? "");
    if (!VERSION_ID.test(versionId)) return reply(400, { error: "versionId must match ^ver_[A-Za-z0-9_-]+$" });
    if (!(await exists(path.join(options.designsDir, "versions", `${versionId}.json`)))) return reply(404, { error: "version_not_found" });

    let text: string;
    try {
      text = await readFile(path.join(options.designsDir, "figma", `${versionId}.json`), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return reply(200, { versionId, status: "pending" });
      throw err;
    }
    let mapping: unknown;
    try {
      mapping = JSON.parse(text);
    } catch {
      return reply(500, { error: `figma/${versionId}.json is not valid JSON` });
    }
    const m = mapping as { versionId?: unknown; status?: unknown };
    if (!m || typeof m !== "object" || m.versionId !== versionId || typeof m.status !== "string") {
      return reply(500, { error: `figma/${versionId}.json is not a Figma mapping for ${versionId}` });
    }
    return reply(200, mapping);
  };

  return (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
    handle(req, res).then((handled) => void (handled || next()), next);
  };
}
