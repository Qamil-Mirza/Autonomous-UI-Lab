import { z } from "zod";

export const SCHEMA_VERSION = "1.0.0" as const;
export const SchemaVersion = z.literal(SCHEMA_VERSION);
export type SchemaVersion = z.infer<typeof SchemaVersion>;
