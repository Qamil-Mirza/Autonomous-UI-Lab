import type { Identity } from "spacetimedb";
import { DbConnection } from "./bindings";

export const DEFAULT_URI = "ws://127.0.0.1:3000";
export const DEFAULT_DATABASE = "ghostloop";

export interface ConnectOptions {
  uri?: string;
  database?: string;
  /** A token from an earlier session, to keep the same identity. Omit for a fresh anonymous identity. */
  token?: string;
  /** SQL subscription queries; defaults to `SELECT * FROM <table>` for every table. */
  subscribe?: string[];
  timeoutMs?: number;
  /**
   * Called once if the connection is lost after `connect` resolved (server restart, network drop). Not called for
   * a deliberate `conn.disconnect()`. The SDK does not reconnect, and reducer calls made after a loss never settle,
   * so stop using `conn` and reconnect (or exit) here.
   */
  onDisconnect?: (err: Error) => void;
}

export interface Connected {
  conn: DbConnection;
  identity: Identity;
  /** Persist this (outside the browser-safe package) and pass it back as `token` to reuse the identity. */
  token: string;
}

/**
 * Opens a connection and resolves once its subscription is applied, so the client cache is populated.
 * Rejects with `CONNECT_FAILED: ...` on a connect or subscription error, a disconnect, or after `timeoutMs`.
 * A loss after that is reported to `opts.onDisconnect`.
 */
export function connect(opts: ConnectOptions = {}): Promise<Connected> {
  const uri = opts.uri ?? DEFAULT_URI;
  const database = opts.database ?? DEFAULT_DATABASE;
  const timeoutMs = opts.timeoutMs ?? 5000;

  return new Promise((resolve, reject) => {
    let settled = false;
    let conn: DbConnection | undefined;

    const fail = (why: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        conn?.disconnect();
      } catch {
        // already closed
      }
      reject(new Error(`CONNECT_FAILED: ${uri} ${database}: ${why}`));
    };
    const timer = setTimeout(() => fail(`timed out after ${timeoutMs}ms`), timeoutMs);

    try {
      conn = DbConnection.builder()
        .withUri(uri)
        .withDatabaseName(database)
        .withToken(opts.token)
        .onConnect((c, identity, token) => {
          const sub = c
            .subscriptionBuilder()
            .onApplied(() => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              resolve({ conn: c, identity, token });
            })
            .onError((ctx) => fail(`subscription failed: ${ctx.event?.message ?? "unknown error"}`));
          if (opts.subscribe) sub.subscribe(opts.subscribe);
          else sub.subscribeToAllTables();
        })
        .onConnectError((_ctx, err) => fail(err.message))
        .onDisconnect((_ctx, err) => {
          if (!settled) return fail(err ? err.message : "disconnected");
          if (conn?.isDisconnectRequested) return; // our caller's own disconnect()
          opts.onDisconnect?.(err ?? new Error("connection closed"));
        })
        .build();
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
  });
}
