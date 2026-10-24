import type { z } from "zod";

/** A stored `json` column that is not valid JSON or does not match its contracts schema. */
export class RowValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RowValidationError";
  }
}

/** Parses a row's `json` column with a contracts schema; throws `RowValidationError` naming the table and key. */
export function parseRow<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, table: string, key: string, json: string): T {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    throw new RowValidationError(`${table} ${key}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new RowValidationError(`${table} ${key}: ${issues}`);
  }
  return parsed.data;
}

/**
 * The `CODE` of a reducer rejection. Module errors are `CODE: detail`; the code is the first
 * all-caps token followed by a colon, so any prefix the client adds is skipped.
 */
export function reducerErrorCode(err: unknown): string | undefined {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : undefined;
  return message?.match(/\b([A-Z][A-Z0-9_]*[A-Z0-9]):/)?.[1];
}
