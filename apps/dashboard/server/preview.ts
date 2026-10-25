import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import type { IncomingMessage, ServerResponse } from "node:http"
import { z } from "zod"
import { MutationPatch, VersionId } from "@ghostloop/contracts"
// Relative imports: Vite bundles relative files into the config but leaves bare workspace imports to Node.
import { applyPatches, PatchError } from "../../../packages/design-engine/src/patch"
import { parseManifest } from "../../../packages/design-engine/src/manifest"

export const PreviewRequest = z.object({
  sourceVersionId: VersionId,
  patches: z.array(MutationPatch).min(1).max(20),
})
export type PreviewRequest = z.infer<typeof PreviewRequest>

const PREVIEW_ID = /^ver_preview_[0-9a-f]{16}$/

/** Same source and patches -> same ID, so re-selecting a combination reuses its file. */
export function previewId(req: PreviewRequest): string {
  const key = JSON.stringify([req.sourceVersionId, req.patches.map((p) => [p.id, p.targetElementId, p.op, p.value]).sort()])
  return `ver_preview_${createHash("sha256").update(key).digest("hex").slice(0, 16)}`
}

export class PreviewError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = "PreviewError"
  }
}

/**
 * Applies proposed patches to the source version with C's patch engine and writes the result as a throwaway
 * design version the prototype can render. It is a preview only: nothing is recorded in the database, and the
 * engine's own checks (protected elements, approved tokens, order rules) still apply.
 */
export async function createPreview(designsDir: string, raw: unknown): Promise<{ versionId: string }> {
  const parsed = PreviewRequest.safeParse(raw)
  if (!parsed.success) throw new PreviewError(400, parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "))
  const req = parsed.data
  const versionsDir = path.join(designsDir, "versions")
  let source
  try {
    source = parseManifest(JSON.parse(await readFile(path.join(versionsDir, `${req.sourceVersionId}.json`), "utf8")))
  } catch {
    throw new PreviewError(404, `design version ${req.sourceVersionId} not found`)
  }
  const id = previewId(req)
  if (!PREVIEW_ID.test(id)) throw new PreviewError(500, "bad preview id")
  let manifest
  try {
    // Previews show proposals before approval, so "proposed" is treated like approved; blocked patches still fail.
    manifest = applyPatches(source, req.patches, { newVersionId: () => id as VersionId })
  } catch (e) {
    if (e instanceof PatchError) throw new PreviewError(422, e.message)
    throw e
  }
  await writeFile(path.join(versionsDir, `${id}.json`), JSON.stringify(manifest, null, 2) + "\n")
  return { versionId: id }
}

/** `POST /api/preview` with a `PreviewRequest` body -> `{ versionId }`, or `{ error }` with a 4xx status. */
export function previewHandler(designsDir: string) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.method !== "POST" || (req.url ?? "").split("?")[0] !== "/") return next()
    const chunks: Buffer[] = []
    let size = 0
    req.on("data", (c: Buffer) => {
      size += c.length
      if (size > 256_000) req.destroy()
      else chunks.push(c)
    })
    req.on("end", () => {
      const send = (status: number, body: unknown) => {
        res.statusCode = status
        res.setHeader("Content-Type", "application/json")
        res.end(JSON.stringify(body))
      }
      let body: unknown
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
      } catch {
        return send(400, { error: "body must be JSON" })
      }
      createPreview(designsDir, body).then(
        (out) => send(200, out),
        (e: unknown) => send(e instanceof PreviewError ? e.status : 500, { error: e instanceof Error ? e.message : String(e) }),
      )
    })
  }
}
