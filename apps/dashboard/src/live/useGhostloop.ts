import { useCallback, useEffect, useRef, useState } from "react"
import type { CommandKind, CommandResult, DesignManifest } from "@ghostloop/contracts"
import { connect, DEFAULT_DATABASE, DEFAULT_URI, submitCommand, type DbConnection } from "@ghostloop/db"
import { emptySnapshot, readSnapshot, type Snapshot } from "./snapshot"
import { fetchManifest } from "./setup"
import type { Element, Elements } from "./view"

export type LinkStatus =
  | { kind: "connecting" }
  | { kind: "live" }
  | { kind: "offline"; message: string }
  | { kind: "lost"; message: string }

const URI = (import.meta.env.VITE_GHOSTLOOP_STDB_URI as string | undefined) ?? DEFAULT_URI
const DATABASE = (import.meta.env.VITE_GHOSTLOOP_STDB_DB as string | undefined) ?? DEFAULT_DATABASE
const TOKEN_KEY = "ghostloop.token"
const NAMES_KEY = "ghostloop.names"

// Storage can be missing or throw (private windows, blocked site data); the dashboard works without it.
function load(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Not persisted; the next load starts fresh.
  }
}

const TABLES = [
  "experiment",
  "designVersion",
  "batch",
  "agentRun",
  "agentAction",
  "observation",
  "hypothesis",
  "packet",
  "patch",
  "candidate",
  "validation",
  "evaluation",
] as const

type Listen = (cb: () => void) => void
type Handle = { onInsert?: Listen; onUpdate?: Listen; onDelete?: Listen }

export interface Ghostloop {
  status: LinkStatus
  snapshot: Snapshot
  /** Submits a designer command and waits for the worker's result; transport failures become `ok: false`. */
  submit: (kind: CommandKind, payload: unknown) => Promise<CommandResult<unknown>>
  retry: () => void
}

/**
 * Live connection to the GhostLoop database. Subscribes to every table and re-reads the whole snapshot (at most
 * once per frame) whenever a row changes; the SDK does not reconnect, so a lost link is shown with a retry.
 */
export function useGhostloop(): Ghostloop {
  const [status, setStatus] = useState<LinkStatus>({ kind: "connecting" })
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot)
  const [attempt, setAttempt] = useState(0)
  const connRef = useRef<DbConnection | null>(null)

  useEffect(() => {
    let closed = false
    let frame = 0
    setStatus({ kind: "connecting" })

    const open = (token: string | undefined) =>
      connect({
        uri: URI,
        database: DATABASE,
        ...(token ? { token } : {}),
        onDisconnect: (err) => {
          if (closed) return
          connRef.current = null
          setStatus({ kind: "lost", message: err.message })
        },
      })

    const saved = load(TOKEN_KEY) ?? undefined
    // A token from a since-reset server is refused; fall back to a fresh identity once.
    open(saved)
      .catch((err: unknown) => (saved ? open(undefined) : Promise.reject(err)))
      .then(({ conn, token }) => {
        if (closed) {
          conn.disconnect()
          return
        }
        save(TOKEN_KEY, token)
        connRef.current = conn
        const refresh = () => {
          if (frame) return
          frame = requestAnimationFrame(() => {
            frame = 0
            if (!closed) setSnapshot(readSnapshot(conn.db))
          })
        }
        for (const name of TABLES) {
          const table = conn.db[name] as unknown as Handle
          table.onInsert?.(refresh)
          table.onUpdate?.(refresh)
          table.onDelete?.(refresh)
        }
        setSnapshot(readSnapshot(conn.db))
        setStatus({ kind: "live" })
      })
      .catch((err: unknown) => {
        if (!closed) setStatus({ kind: "offline", message: err instanceof Error ? err.message : String(err) })
      })

    return () => {
      closed = true
      if (frame) cancelAnimationFrame(frame)
      connRef.current?.disconnect()
      connRef.current = null
    }
  }, [attempt])

  const submit = useCallback(async (kind: CommandKind, payload: unknown): Promise<CommandResult<unknown>> => {
    const conn = connRef.current
    if (!conn) return { ok: false, code: "INTERNAL", message: "Not connected to the GhostLoop database." }
    try {
      return await submitCommand(conn, kind, payload)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const hint = message.startsWith("COMMAND_TIMEOUT") ? " Is the worker running (npm run worker)?" : ""
      return { ok: false, code: "INTERNAL", message: `${message}${hint}` }
    }
  }, [])

  return { status, snapshot, submit, retry: useCallback(() => setAttempt((n) => n + 1), []) }
}

/** The manifest elements of one design version, keyed by element ID; empty until loaded or if unavailable. */
export function useElements(versionId: string | undefined): Elements {
  const [elements, setElements] = useState<Elements>(new Map())
  useEffect(() => {
    if (!versionId) return
    let current = true
    fetchManifest(versionId)
      .then((m: DesignManifest) => {
        if (current) setElements(new Map(m.elements.map((el) => [el.elementId, el as Element])))
      })
      .catch(() => {
        if (current) setElements(new Map())
      })
    return () => {
      current = false
    }
  }, [versionId])
  return elements
}

/** Designer-given experiment names (the protocol has no name field), kept in this browser. */
export function useNames(): [Record<string, string>, (id: string, name: string) => void] {
  const [names, setNames] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(load(NAMES_KEY) ?? "{}") as Record<string, string>
    } catch {
      return {}
    }
  })
  const setName = useCallback((id: string, name: string) => {
    setNames((prev) => {
      const next = { ...prev, [id]: name }
      save(NAMES_KEY, JSON.stringify(next))
      return next
    })
  }, [])
  return [names, setName]
}
