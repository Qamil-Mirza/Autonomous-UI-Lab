import { z } from "zod";
import { SuccessCheck } from "./task";

/** What a suggester sees: the task, the starting page as rendered, and the app's own vocabulary and routes. */
export interface SuggestInput {
  task: string;
  startRoute: string;
  startPage: { url: string; text: string; controls: { role: string; label: string }[]; screenshotPath: string };
  /** Literal JSX text from the source, with the file it is in: what any screen of the app can show. */
  appTexts: { text: string; file: string }[];
  /** Route-like string literals found in the source. */
  routes: string[];
}

/** A model that proposes success checks. Its output is untrusted until `groundSuggestions` accepts it. */
export interface CheckSuggester {
  readonly model: string;
  suggest(input: SuggestInput, signal?: AbortSignal): Promise<{ raw: unknown; usd: number }>;
}

const RawCheck = z
  .object({
    kind: z.enum(["route", "text", "control"]),
    path: z.string().optional(),
    text: z.string().optional(),
    match: z.string().optional(),
    role: z.string().optional(),
    name: z.string().optional(),
    why: z.string().default(""),
  })
  .passthrough();
const RawSuggestions = z.object({ checks: z.array(z.unknown()).max(10) });

export interface Suggestion {
  check: SuccessCheck;
  why: string;
}
export interface GroundedSuggestions {
  suggestions: Suggestion[];
  rejected: { proposed: string; reason: string }[];
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
/** "/a/" → "/a"; "/" stays "/". */
const normRoute = (r: string) => (r.length > 1 ? r.replace(/\/+$/, "") || "/" : r);
const MAX_SUGGESTIONS = 3;

/** Route-like string literals in the app's source (`"/checkout"`, `'/order/confirmed'`), excluding file paths. */
export function findRoutes(files: ReadonlyMap<string, Buffer>): string[] {
  const out = new Set<string>();
  for (const [path, data] of files) {
    if (!/^src\/.+\.(tsx?|jsx?)$/.test(path)) continue;
    for (const m of data.toString("utf8").matchAll(/["'`](\/[A-Za-z0-9_\-/:#]*)["'`]/g)) {
      const r = m[1]!;
      if (r.startsWith("//") || r.length > 80) continue;
      out.add(normRoute(r));
    }
  }
  return [...out].sort().slice(0, 60);
}

/**
 * Accepts only suggestions a designer could rely on: valid checks, grounded in the app's own text or routes, not
 * already satisfied on the starting page (they could not tell success apart), without duplicates, at most three.
 * Everything else is reported with the reason, so nothing is silently dropped.
 */
export async function groundSuggestions(
  raw: unknown,
  ctx: { appTexts: { text: string }[]; routes: string[]; startRoute: string; passesAtStart: (c: SuccessCheck) => Promise<boolean> },
): Promise<GroundedSuggestions> {
  const parsed = RawSuggestions.safeParse(raw);
  if (!parsed.success) return { suggestions: [], rejected: [{ proposed: "(response)", reason: "the suggestion response was not in the expected format" }] };
  const texts = ctx.appTexts.map((t) => norm(t.text));
  const routes = new Set(ctx.routes.map(normRoute));
  const start = normRoute(ctx.startRoute);
  const suggestions: Suggestion[] = [];
  const rejected: GroundedSuggestions["rejected"] = [];
  const seen = new Set<string>();
  for (const item of parsed.data.checks) {
    const r = RawCheck.safeParse(item);
    const proposed = JSON.stringify(item).slice(0, 160);
    if (!r.success) {
      rejected.push({ proposed, reason: "not a valid check" });
      continue;
    }
    const { why, ...fields } = r.data;
    const shaped =
      fields.kind === "route" ? { kind: "route", path: fields.path, match: fields.match === "prefix" ? "prefix" : "exact" }
      : fields.kind === "text" ? { kind: "text", text: fields.text, match: fields.match === "exact" ? "exact" : "contains" }
      : { kind: "control", role: fields.role, name: fields.name };
    const check = SuccessCheck.safeParse(shaped);
    if (!check.success) {
      rejected.push({ proposed, reason: check.error.issues[0]?.message ?? "not a valid check" });
      continue;
    }
    const c = check.data;
    const key = JSON.stringify(c);
    if (seen.has(key)) continue;
    seen.add(key);
    if (c.kind === "route") {
      const p = normRoute(c.path);
      if (!routes.has(p) && !(c.match === "prefix" && [...routes].some((x) => x.startsWith(p)))) {
        rejected.push({ proposed, reason: `the app's code never mentions the route ${c.path}` });
        continue;
      }
      if (p === start || (c.match === "prefix" && start.startsWith(p))) {
        rejected.push({ proposed, reason: "that is the starting route" });
        continue;
      }
    } else {
      const want = norm(c.kind === "text" ? c.text : c.name);
      const grounded = c.kind === "text" && c.match === "contains" ? texts.some((t) => t.includes(want)) : texts.some((t) => t === want || t.includes(want));
      if (!grounded) {
        rejected.push({ proposed, reason: `“${c.kind === "text" ? c.text : c.name}” is not text this app shows` });
        continue;
      }
    }
    if (await ctx.passesAtStart(c)) {
      rejected.push({ proposed, reason: "it is already true on the starting page" });
      continue;
    }
    if (suggestions.length >= MAX_SUGGESTIONS) {
      rejected.push({ proposed, reason: `only the first ${MAX_SUGGESTIONS} usable suggestions are kept` });
      continue;
    }
    suggestions.push({ check: c, why: why.trim().slice(0, 300) });
  }
  return { suggestions, rejected };
}
