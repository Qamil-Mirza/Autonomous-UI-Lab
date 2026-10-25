import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { beforeEach, describe, expect, it } from "vitest"
import { createPreview, previewId, PreviewError } from "../server/preview"

const baseline = path.resolve(__dirname, "../../../designs/versions/ver_baseline.json")

const patch = (over: Record<string, unknown> = {}) => ({
  schemaVersion: "1.0.0",
  id: "pat_1",
  experimentId: "exp_a",
  round: 1,
  sourceVersionId: "ver_baseline",
  targetElementId: "plan.free.cta",
  observationIds: ["obs_1"],
  rationale: "Name the plan.",
  risk: "low",
  state: "proposed",
  op: "set_label",
  value: "Continue with Free",
  ...over,
})

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "ghostloop-preview-"))
  await mkdir(path.join(dir, "versions"))
  await writeFile(path.join(dir, "versions", "ver_baseline.json"), await readFile(baseline))
})

describe("createPreview", () => {
  it("writes the source with the proposed patches applied as a preview version", async () => {
    const { versionId } = await createPreview(dir, { sourceVersionId: "ver_baseline", patches: [patch()] })
    expect(versionId).toMatch(/^ver_preview_[0-9a-f]{16}$/)
    const written = JSON.parse(await readFile(path.join(dir, "versions", `${versionId}.json`), "utf8"))
    expect(written.versionId).toBe(versionId)
    expect(written.parentVersionId).toBe("ver_baseline")
    expect(written.elements.find((e: { elementId: string }) => e.elementId === "plan.free.cta").label).toBe("Continue with Free")
  })

  it("gives the same combination the same ID regardless of order", () => {
    const a = patch()
    const b = patch({ id: "pat_2", op: "set_style_token", value: "button.primary" })
    expect(previewId({ sourceVersionId: "ver_baseline", patches: [a, b] } as never)).toBe(
      previewId({ sourceVersionId: "ver_baseline", patches: [b, a] } as never),
    )
    expect(previewId({ sourceVersionId: "ver_baseline", patches: [a] } as never)).not.toBe(
      previewId({ sourceVersionId: "ver_baseline", patches: [b] } as never),
    )
  })

  it("refuses patches the engine refuses, such as a protected element", async () => {
    const err = await createPreview(dir, { sourceVersionId: "ver_baseline", patches: [patch({ targetElementId: "plan.pro.price", value: "Free" })] }).catch((e) => e)
    expect(err).toBeInstanceOf(PreviewError)
    expect(err.status).toBe(422)
    expect(err.message).toContain("protected")
  })

  it("reports a missing source version and a malformed request", async () => {
    await expect(createPreview(dir, { sourceVersionId: "ver_missing", patches: [patch({ sourceVersionId: "ver_missing" })] })).rejects.toMatchObject({ status: 404 })
    await expect(createPreview(dir, { sourceVersionId: "ver_baseline", patches: [] })).rejects.toMatchObject({ status: 400 })
    await expect(createPreview(dir, { sourceVersionId: "../etc", patches: [patch()] })).rejects.toMatchObject({ status: 400 })
  })
})
