import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * Observable success checks for an imported app. Each is evaluated by GhostLoop against the live page, never by
 * the simulated user or a model. They are evidence that the UI reached a state, not that a backend did anything.
 */
export const RouteCheck = z
  .object({
    kind: z.literal("route"),
    /** Path to compare with the page URL's path, e.g. "/confirmation"; "#/done" compares the hash instead. */
    path: z.string().min(1).max(300).regex(/^(\/|#\/)[^\s]*$/, "a route starts with / (or #/ for hash routes) and has no spaces"),
    match: z.enum(["exact", "prefix"]).default("exact"),
  })
  .strict();
export const TextCheck = z
  .object({
    kind: z.literal("text"),
    text: z.string().trim().min(1).max(200),
    match: z.enum(["contains", "exact"]).default("contains"),
  })
  .strict();
export const CONTROL_ROLES = ["button", "link", "textbox", "checkbox", "radio", "switch", "tab", "combobox", "heading"] as const;
export const ControlCheck = z
  .object({
    kind: z.literal("control"),
    role: z.enum(CONTROL_ROLES),
    name: z.string().trim().min(1).max(200),
  })
  .strict();
export const SuccessCheck = z.discriminatedUnion("kind", [RouteCheck, TextCheck, ControlCheck]);
export type SuccessCheck = z.infer<typeof SuccessCheck>;

const Persona = z
  .object({
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().min(1).max(600),
  })
  .strict();

/** What the designer describes on the import page. Frozen (hashed and immutable) before a baseline runs. */
export const ImportTask = z
  .object({
    task: z.string().trim().min(10, "describe the task in a sentence or more").max(2000),
    startRoute: z
      .string()
      .max(300)
      .regex(/^\/(?!\/)[^\s]*$/, "the starting route is a path on the preview, like / or /checkout"),
    viewport: z.object({ width: z.number().int().min(320).max(1920), height: z.number().int().min(480).max(1400) }).strict(),
    /** All must pass ("all of"); the only combination supported. */
    successChecks: z.array(SuccessCheck).min(1, "add at least one success check").max(5),
    /** Visible text that must not change (matched against editable text, case-insensitive). */
    protectedTexts: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
    /** Behavior that must keep working, in the designer's words; shown to the model as constraints. */
    protectedBehavior: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
    /** Test data the simulated users may type (e.g. name, email). Fictional values only. */
    inputs: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/), z.string().max(200)).default({}),
    /** Optional personas; defaults are used when empty. */
    personas: z.array(Persona).max(4).default([]),
  })
  .strict()
  .superRefine((t, ctx) => {
    const seen = new Set<string>();
    t.successChecks.forEach((c, i) => {
      const key = checkName(c);
      if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["successChecks", i], message: "duplicate success check" });
      seen.add(key);
    });
    if (Object.keys(t.inputs).length > 10) ctx.addIssue({ code: "custom", path: ["inputs"], message: "at most 10 inputs" });
  });
export type ImportTask = z.infer<typeof ImportTask>;
export type ImportTaskDraft = z.input<typeof ImportTask>;

/** Unique, stable name for a check, used as the GoalCheck name. */
export function checkName(c: SuccessCheck): string {
  switch (c.kind) {
    case "route":
      return `route ${c.match === "prefix" ? "starts with" : "is"} ${c.path}`;
    case "text":
      return `text ${c.match === "exact" ? "equals" : "contains"} "${c.text}"`;
    case "control":
      return `${c.role} "${c.name}" visible`;
  }
}

/** Plain-language statement of exactly what a check verifies, for the designer. */
export function describeCheck(c: SuccessCheck): string {
  switch (c.kind) {
    case "route":
      return c.path.startsWith("#")
        ? `The page's URL hash ${c.match === "prefix" ? "starts with" : "is exactly"} ${c.path}.`
        : `The page's URL path ${c.match === "prefix" ? "starts with" : "is exactly"} ${c.path} (query and hash ignored).`;
    case "text":
      return c.match === "exact"
        ? `Some visible element's text is exactly “${c.text}” (case and spacing ignored).`
        : `The visible page text contains “${c.text}” (case and spacing ignored).`;
    case "control":
      return `A visible ${c.role} whose accessible name is “${c.name}” is on the page.`;
  }
}

export const CHECK_CAVEAT =
  "These checks read what the page shows. A visible confirmation is evidence the UI flow completed, not proof that an email was sent, a payment was taken or a backend saved anything.";

export const DEFAULT_PERSONAS = [
  { name: "Careful first-time visitor", description: "You have never used this product. Read labels before acting and avoid anything that costs money." },
  { name: "Confident regular", description: "You use apps like this often and move quickly through familiar steps." },
  { name: "Low patience", description: "You have little patience. If you get stuck, see the same problem twice, or feel you are going in circles, stop and say why." },
];

/** The immutable record a baseline and every retest are run under. Stored outside any candidate's source. */
export const FrozenTask = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    importId: z.string().min(1),
    baseVersionId: z.string().min(1),
    task: ImportTask,
    frozenAt: z.string().datetime(),
  })
  .strict();
export type FrozenTask = z.infer<typeof FrozenTask>;

/** Canonical JSON (sorted keys) so the same content always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

export const TASK_REF_PREFIX = "import-task:";
export const taskHash = (t: FrozenTask) => sha256(canonicalJson(t));
export const taskRef = (hash: string) => `${TASK_REF_PREFIX}${hash}`;
export function parseTaskRef(ref: string): string | undefined {
  if (!ref.startsWith(TASK_REF_PREFIX)) return undefined;
  const hash = ref.slice(TASK_REF_PREFIX.length);
  return /^[0-9a-f]{64}$/.test(hash) ? hash : undefined;
}
