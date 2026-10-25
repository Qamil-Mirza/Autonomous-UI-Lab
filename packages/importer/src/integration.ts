import type { AppIntegration } from "@ghostloop/simulator";
import { evaluateChecks } from "./checks";
import { checkName, type FrozenTask } from "./task";

/** Static resources an imported app may load from other origins (fonts, images); never scripts or API calls. */
const EXTERNAL_RESOURCE_TYPES = new Set(["image", "font", "stylesheet", "media"]);

/**
 * Whether a request from an imported app's page may proceed. Everything on the preview origin is allowed;
 * navigation never leaves it; other origins may serve passive resources only, so the app cannot reach real
 * backends, analytics or third-party scripts during a test.
 */
export function previewRequestPolicy(origin: string) {
  const preview = new URL(origin);
  return (url: string, navigation: boolean, resourceType = "other"): boolean => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return false;
    }
    if (u.protocol === "data:" || u.protocol === "blob:") return !navigation;
    if (u.username || u.password) return false;
    if (u.origin === preview.origin) return true;
    if (navigation) return false;
    return (u.protocol === "https:" || u.protocol === "http:") && EXTERNAL_RESOURCE_TYPES.has(resourceType);
  };
}

/**
 * The simulator integration for one imported version under one frozen task. Each run gets its own browser context
 * (fresh storage, cookies and app state; the preview itself is static), starts at the frozen route and viewport,
 * discovers controls from the rendered page, and is judged only by the frozen page checks.
 */
export function importedIntegration(args: { versionId: string; origin: string; frozen: FrozenTask; touch?: () => void }): AppIntegration {
  const { task } = args.frozen;
  const allow = previewRequestPolicy(args.origin);
  const start = new URL(task.startRoute, args.origin).href;
  return {
    kind: "imported-app",
    versionId: args.versionId,
    url: () => start,
    initialize: async () => {
      args.touch?.();
      return undefined;
    },
    checkGoal: async (runId, page) => {
      if (!page) throw new Error("Imported-app checks need the run's page");
      args.touch?.();
      return evaluateChecks(page, task.successChecks, runId);
    },
    requiredChecks: task.successChecks.map(checkName),
    cleanup: async () => {},
    allowRequest: (url, navigation, _runId, resourceType) => allow(url, navigation, resourceType),
    discover: true,
    viewport: task.viewport,
  };
}
