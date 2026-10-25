// GhostLoop's trusted preview server. Runs inside the preview container and serves a built app's static files
// from /srv (mounted read-only). It never executes uploaded code: the app runs only in the viewer's browser.
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = "/srv";
const PORT = 8080;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wasm": "application/wasm",
};

async function resolveFile(urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  } catch {
    return null;
  }
  if (rel.includes("\0")) return null;
  const file = path.resolve(ROOT, `.${rel}`);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return null;
  try {
    // Symlinks may not point outside the served tree.
    const real = await realpath(file);
    if (real !== ROOT && !real.startsWith(ROOT + path.sep)) return null;
    const s = await stat(real);
    if (s.isDirectory()) return resolveFile(`${rel.replace(/\/$/, "")}/index.html`);
    return s.isFile() ? { file: real, size: s.size } : null;
  } catch {
    return null;
  }
}

createServer(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  const url = req.url || "/";
  let found = await resolveFile(url);
  // Single-page app fallback: unknown paths without a file extension get index.html.
  if (!found && !path.extname(url.split("?")[0])) found = await resolveFile("/index.html");
  if (!found) {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
    return;
  }
  res.writeHead(200, {
    "Content-Type": TYPES[path.extname(found.file).toLowerCase()] || "application/octet-stream",
    "Content-Length": found.size,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-GhostLoop-Preview": "1",
  });
  if (req.method === "HEAD") res.end();
  else createReadStream(found.file).pipe(res);
}).listen(PORT, "0.0.0.0");
