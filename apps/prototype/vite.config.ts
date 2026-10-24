import { createReadStream, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Connect, Plugin } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const designsDir = fileURLToPath(new URL("../../designs", import.meta.url));

// Serves repo-root designs/ at /designs from disk on every request, in dev and preview,
// so candidate manifests written after startup (or after a build) load without a rebuild.
function serveDesigns(): Plugin {
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const rel = decodeURIComponent((req.url ?? "").split("?")[0] ?? "");
    const file = path.resolve(designsDir, `.${rel}`);
    if (!file.startsWith(designsDir + path.sep)) return next();
    let size: number;
    try {
      const stat = statSync(file);
      if (!stat.isFile()) return next();
      size = stat.size;
    } catch {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader("Content-Type", file.endsWith(".json") ? "application/json" : "application/octet-stream");
    res.setHeader("Content-Length", size);
    res.setHeader("Cache-Control", "no-store");
    createReadStream(file).pipe(res);
  };
  return {
    name: "ghostloop-serve-designs",
    configureServer: (server) => void server.middlewares.use("/designs", handler),
    configurePreviewServer: (server) => void server.middlewares.use("/designs", handler),
  };
}

export default defineConfig({
  plugins: [react(), serveDesigns()],
  server: { port: 5173 },
});
