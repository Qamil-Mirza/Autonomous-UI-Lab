import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The prototype server serves design manifests at /designs; proxy them so the dashboard can read labels without CORS.
const prototype = process.env.GHOSTLOOP_PROTOTYPE_URL ?? "http://localhost:5173";

// Designer dashboard. 5174 so it runs beside the prototype (5173).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: { port: 5174, strictPort: true, proxy: { "/designs": prototype } },
  preview: { port: 5174, strictPort: true, proxy: { "/designs": prototype } },
});
