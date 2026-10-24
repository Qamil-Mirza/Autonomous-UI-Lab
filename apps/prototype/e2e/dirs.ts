import { tmpdir } from "node:os";
import path from "node:path";

// Fixed temp locations shared by playwright.config.ts (server env) and the specs, so e2e never writes into the repo.
export const E2E_RUNS_DIR = path.join(tmpdir(), "ghostloop-e2e-runs");
export const E2E_DESIGNS_DIR = path.join(tmpdir(), "ghostloop-e2e-designs");
