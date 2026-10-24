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
}).superRefine((m, ctx) => {
  const seen = new Set<string>();
  m.elements.forEach((el, i) => {
    if (seen.has(el.elementId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["elements", i, "elementId"],
        message: `duplicate elementId "${el.elementId}": manifest elementIds must be unique`,
      });
    }
    seen.add(el.elementId);
  });
});
export type DesignManifest = z.infer<typeof DesignManifest>;
