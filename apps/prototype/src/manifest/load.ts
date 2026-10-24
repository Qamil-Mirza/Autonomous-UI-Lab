import { parseManifest, type PresentedManifest } from "@ghostloop/design-engine";
import { ELEMENT_IDS } from "./ids";

const VERSION_ID = /^ver_[A-Za-z0-9_-]+$/;

// Fetched at runtime (never bundled) so candidate versions written after a build still load.
export async function loadManifest(versionId: string): Promise<PresentedManifest> {
  if (!VERSION_ID.test(versionId)) {
    throw new Error(`"${versionId}" is not a valid version ID`);
  }
  const res = await fetch(`/designs/versions/${versionId}.json`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`No manifest for ${versionId} (HTTP ${res.status})`);
  }
  const manifest = parseManifest(await res.json());
  if (manifest.versionId !== versionId) {
    throw new Error(`Manifest file for ${versionId} declares versionId ${manifest.versionId}`);
  }
  const present = new Set(manifest.elements.map((el) => el.elementId));
  const missing = ELEMENT_IDS.filter((id) => !present.has(id));
  if (missing.length > 0) {
    throw new Error(`Manifest ${versionId} is missing elements: ${missing.join(", ")}`);
  }
  return manifest;
}
