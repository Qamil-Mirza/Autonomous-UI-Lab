import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import type { Connect, Plugin } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The prototype server serves design manifests at /designs; proxy them so the dashboard can read labels without CORS.
const prototype = process.env.GHOSTLOOP_PROTOTYPE_URL ?? "http://localhost:5173";
// Simulator screenshots: the worker publishes them as /artifacts/... URLs relative to this directory.
const artifactsDir = path.resolve(process.env.GHOSTLOOP_ARTIFACTS_DIR ?? path.join(__dirname, "../../workers/simulator/artifacts"));

// Design manifests live here; the prototype serves the same directory, so preview versions written here render there.
const designsDir = path.resolve(process.env.GHOSTLOOP_DESIGNS_DIR ?? path.join(__dirname, "../../designs"));

// POST /api/preview: applies proposed patches to a version and writes a throwaway preview version (server/preview.ts).
// Loaded through Vite's SSR loader per request: the config loader can't import workspace TypeScript packages.
// Dev server only.
function servePreviews(): Plugin {
  return {
    name: "ghostloop-previews",
    configureServer: (server) =>
      void server.middlewares.use("/api/preview", (req, res, next) => {
        server
          .ssrLoadModule("/server/preview.ts")
          .then((m) => (m as typeof import("./server/preview")).previewHandler(designsDir)(req, res, next))
          .catch(next);
      }),
  };
}

// Serves PNG screenshots from artifactsDir at /artifacts, read from disk per request so new runs show up live.
function serveArtifacts(): Plugin {
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const rel = decodeURIComponent((req.url ?? "").split("?")[0] ?? "");
    const file = path.resolve(artifactsDir, `.${rel}`);
    if (!file.startsWith(artifactsDir + path.sep) || !file.endsWith(".png")) return next();
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
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Length", size);
    createReadStream(file).pipe(res);
  };
  return {
    name: "ghostloop-serve-artifacts",
    configureServer: (server) => void server.middlewares.use("/artifacts", handler),
    configurePreviewServer: (server) => void server.middlewares.use("/artifacts", handler),
  };
}

// The worker's import API (uploads, sandbox status, imported manifests). Previews themselves are served on their own
// loopback origins (127.0.0.1:47xxx), never through the dashboard's origin.
const importApi = process.env.GHOSTLOOP_IMPORT_API_URL ?? "http://127.0.0.1:5180";
const proxy = {
  "/designs": prototype,
  "/api/imports": { target: importApi, timeout: 5 * 60_000, proxyTimeout: 5 * 60_000 },
  "/api/import-versions": importApi,
  "/api/import-runtime": importApi,
};

// Designer dashboard. 5174 so it runs beside the prototype (5173).
export default defineConfig({
  plugins: [react(), tailwindcss(), serveArtifacts(), servePreviews()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: { port: 5174, strictPort: true, proxy },
  preview: { port: 5174, strictPort: true, proxy },
});
