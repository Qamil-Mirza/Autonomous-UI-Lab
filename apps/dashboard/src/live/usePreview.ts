import { useEffect, useState } from "react"
import type { MutationPatch } from "@ghostloop/contracts"

export type PreviewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; versionId: string }
  | { kind: "error"; message: string }

/**
 * A throwaway design version with `patches` applied to `sourceVersionId`, built by the dashboard server
 * (`POST /api/preview`) so the prototype can render the proposal before anything is approved.
 */
export function usePreview(sourceVersionId: string | undefined, patches: MutationPatch[]): PreviewState {
  const [state, setState] = useState<PreviewState>({ kind: "idle" })
  const key = JSON.stringify(patches.map((p) => p.id).sort())

  useEffect(() => {
    if (!sourceVersionId || patches.length === 0) {
      setState({ kind: "idle" })
      return
    }
    let current = true
    setState({ kind: "loading" })
    // Debounced so ticking several boxes quickly builds one preview.
    const timer = setTimeout(() => {
      fetch("/api/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceVersionId, patches }),
      })
        .then(async (res) => {
          const body = (await res.json().catch(() => ({}))) as { versionId?: string; error?: string }
          if (!current) return
          if (res.ok && body.versionId) setState({ kind: "ready", versionId: body.versionId })
          else setState({ kind: "error", message: body.error ?? `Preview failed (${res.status})` })
        })
        .catch(() => {
          if (current) setState({ kind: "error", message: "Couldn't build the preview. Is the dashboard dev server running?" })
        })
    }, 250)
    return () => {
      current = false
      clearTimeout(timer)
    }
    // `key` stands in for `patches`, which is a new array on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceVersionId, key])

  return state
}
