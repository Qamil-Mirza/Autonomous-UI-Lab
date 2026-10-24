import { fileURLToPath } from "node:url";

// Repo-root designs/ unless GHOSTLOOP_DESIGNS_DIR points elsewhere. The prototype's Vite server serves this same
// directory at /designs, so candidates written here load without a rebuild.
export function defaultDesignsDir(): string {
  return process.env.GHOSTLOOP_DESIGNS_DIR ?? fileURLToPath(new URL("../../../designs", import.meta.url));
}

export const VERSION_ID = /^ver_[A-Za-z0-9_-]+$/;
export const CANDIDATE_ID = /^cand_[A-Za-z0-9_-]+$/;
