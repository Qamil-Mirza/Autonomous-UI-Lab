import { z } from "zod";
import { SchemaVersion } from "./version";
import { VersionId } from "./ids";
import { MutationOp, ProtectedCategory } from "./enums";

export const ManifestElement = z.object({
  elementId: z.string().min(1),
  screen: z.string().min(1),
  role: z.string().min(1),
  label: z.string().optional(),
  protected: z.boolean(),
  categories: z.array(ProtectedCategory),
  supportedOps: z.array(MutationOp),
});
export type ManifestElement = z.infer<typeof ManifestElement>;

export const DesignManifest = z.object({
  schemaVersion: SchemaVersion,
  versionId: VersionId,
  parentVersionId: VersionId.optional(),
  manifestHash: z.string().min(1),
  elements: z.array(ManifestElement),
});
export type DesignManifest = z.infer<typeof DesignManifest>;
