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

// Designer dashboard. 5174 so it runs beside the prototype (5173).
export default defineConfig({
  plugins: [react(), tailwindcss(), serveArtifacts()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: { port: 5174, strictPort: true, proxy: { "/designs": prototype } },
  preview: { port: 5174, strictPort: true, proxy: { "/designs": prototype } },
});
