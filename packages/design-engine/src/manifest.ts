import { z } from "zod";
import { DesignManifest, ManifestElement, SchemaVersion, VersionId } from "@ghostloop/contracts";

// Approved style tokens a set_style_token patch may assign.
export const StyleToken = z.enum(["button.primary", "button.secondary", "emphasis.strong"]);
export type StyleToken = z.infer<typeof StyleToken>;

// ManifestElement plus the presentation state that set_style_token / set_order / set_visibility mutate.
export const PresentedElement = ManifestElement.extend({
  styleToken: StyleToken.optional(),
  order: z.number().int().nonnegative().optional(),
  visible: z.boolean().optional(),
});
export type PresentedElement = z.infer<typeof PresentedElement>;

export const PresentedManifest = z.object({
  schemaVersion: SchemaVersion,
  versionId: VersionId,
  parentVersionId: VersionId.optional(),
  manifestHash: z.string().min(1),
  elements: z.array(PresentedElement),
});
export type PresentedManifest = z.infer<typeof PresentedManifest>;

// Validates against the contract first (including its duplicate-elementId rule), then the presentation fields.
export function parseManifest(json: unknown): PresentedManifest {
  DesignManifest.parse(json);
  return PresentedManifest.parse(json);
}
