import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { FigmaReference, VersionId } from "@ghostloop/contracts";
import { checkBaseline, checkVariant, FigmaCheck, parseManifest, type FigmaSnapshot, type PresentedManifest } from "@ghostloop/design-engine";

export const FIGMA_METHOD = "Claude Code via Figma MCP, designer-triggered";

// designs/figma/<versionId>.json: the contract's FigmaReference plus the read-back record behind its status.
export const FigmaMapping = FigmaReference.extend({
  versionId: VersionId,
  parentVersionId: VersionId.nullable(),
  fileKey: z.string().min(1),
  frames: z.array(z.object({ screen: z.string(), nodeId: z.string(), name: z.string() })),
  checks: z.array(FigmaCheck),
  checkedAt: z.string().datetime(),
  method: z.string().min(1),
});
export type FigmaMapping = z.infer<typeof FigmaMapping>;

export interface BuildFigmaMappingInput {
  manifest: PresentedManifest;
  // The parent's manifest and its frames' snapshot; omit both for an original design (checked against its own frames).
  parent?: { manifest: PresentedManifest; snapshot: FigmaSnapshot };
  // The version's own frames: the variant frames for a candidate, the baseline frames for an original design.
  snapshot: FigmaSnapshot;
  frameUrl: string;
  checkedAt?: string;
}

export function buildFigmaMapping(input: BuildFigmaMappingInput): FigmaMapping {
  const { manifest, parent, snapshot } = input;
  if (parent && manifest.parentVersionId !== parent.manifest.versionId) {
    throw new Error(`${manifest.versionId} has parent ${manifest.parentVersionId ?? "none"}, not ${parent.manifest.versionId}`);
  }
  if (!parent && manifest.parentVersionId) throw new Error(`${manifest.versionId} is a candidate of ${manifest.parentVersionId}; pass the parent and its snapshot`);
  const { status, checks } = parent
    ? checkVariant({ parent: parent.manifest, child: manifest, baselineFrames: parent.snapshot.frames, variantFrames: snapshot.frames })
    : checkBaseline({ manifest, frames: snapshot.frames });
  return FigmaMapping.parse({
    versionId: manifest.versionId,
    parentVersionId: manifest.parentVersionId ?? null,
    manifestHash: manifest.manifestHash,
    patchIds: manifest.patchIds ?? [],
    frameUrl: input.frameUrl,
    status,
    fileKey: snapshot.fileKey,
    frames: snapshot.frames.map(({ screen, nodeId, name }) => ({ screen, nodeId, name })),
    checks,
    checkedAt: input.checkedAt ?? new Date().toISOString(),
    method: FIGMA_METHOD,
  });
}

export const figmaMappingFile = (designsDir: string, versionId: string) => path.join(designsDir, "figma", `${versionId}.json`);

export async function readVersion(designsDir: string, versionId: string): Promise<PresentedManifest> {
  const manifest = parseManifest(JSON.parse(await readFile(path.join(designsDir, "versions", `${versionId}.json`), "utf8")));
  if (manifest.versionId !== versionId) throw new Error(`versions/${versionId}.json declares versionId ${manifest.versionId}`);
  return manifest;
}

// Overwrites any earlier mapping: a mapping records the latest read-back, not a design version.
export async function writeFigmaMapping(designsDir: string, mapping: FigmaMapping): Promise<string> {
  const file = figmaMappingFile(designsDir, mapping.versionId);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(FigmaMapping.parse(mapping), null, 2) + "\n");
  return file;
}
