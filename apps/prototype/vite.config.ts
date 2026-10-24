import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import type { Connect, Plugin } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// Relative imports (not "@ghostloop/prototype-adapter"): Vite bundles relative files into the config but leaves
// bare package imports to Node, which can't load the package's extensionless TypeScript source.
import { createRunsApi } from "../../packages/prototype-adapter/src/http";
import { defaultRunsDir } from "../../packages/prototype-adapter/src/store";
import { defaultDesignsDir } from "../../packages/prototype-adapter/src/designs";


// Serves designs/ (GHOSTLOOP_DESIGNS_DIR, default <repo>/designs, the same directory the CandidateAdapter writes to) at
// /designs from disk on every request, in dev and preview, so candidate manifests written after startup load without a rebuild.
function serveDesigns(): Plugin {
  const designsDir = path.resolve(defaultDesignsDir());
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

// Run-scoped app state API (/api/runs/...) on the same port as the app, in dev and preview.
// State is persisted per run under GHOSTLOOP_RUNS_DIR (default <repo>/.runs).
function serveRunsApi(): Plugin {
  const handler = createRunsApi({ dir: defaultRunsDir() });
  return {
    name: "ghostloop-runs-api",
    configureServer: (server) => void server.middlewares.use(handler),
    configurePreviewServer: (server) => void server.middlewares.use(handler),
  };
}

export default defineConfig({
  plugins: [react(), serveDesigns(), serveRunsApi()],
  server: { port: 5173 },
});
