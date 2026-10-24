import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { E2E_DESIGNS_DIR, E2E_RUNS_DIR } from "./e2e/dirs";

const PORT = 5174;

// Fresh designs dir holding only the baseline; candidate specs write into it. Only the main process resets it
// (workers re-evaluate this file and must not wipe candidates mid-run).
if (!process.env.TEST_WORKER_INDEX) {
  rmSync(E2E_DESIGNS_DIR, { recursive: true, force: true });
  mkdirSync(path.join(E2E_DESIGNS_DIR, "versions"), { recursive: true });
  copyFileSync(fileURLToPath(new URL("../../designs/versions/ver_baseline.json", import.meta.url)), path.join(E2E_DESIGNS_DIR, "versions", "ver_baseline.json"));
}

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: `vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    // Keep e2e runs and candidates out of the repo's .runs/ and designs/.
    env: { GHOSTLOOP_RUNS_DIR: E2E_RUNS_DIR, GHOSTLOOP_DESIGNS_DIR: E2E_DESIGNS_DIR },
  },
});
