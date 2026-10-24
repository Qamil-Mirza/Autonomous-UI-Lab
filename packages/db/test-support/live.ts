// Node-only helpers for live tests against a local SpacetimeDB server (GHOSTLOOP_STDB_TEST=1).
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_URI } from "../src/connect";

const MODULE_PATH = fileURLToPath(new URL("../../../spacetimedb", import.meta.url));
const published = new Map<string, Promise<{ uri: string; database: string }>>();

/**
 * Publishes the module to a fresh database `name` (existing data deleted), once per process per name.
 * Throws a message naming `npm run stdb:start` if the CLI or server is unavailable.
 */
export function publishTestDb(name: string): Promise<{ uri: string; database: string }> {
  let p = published.get(name);
  if (!p) {
    p = publish(name);
    published.set(name, p);
  }
  return p;
}

function publish(database: string): Promise<{ uri: string; database: string }> {
  const uri = process.env.GHOSTLOOP_STDB_URI ?? DEFAULT_URI;
  const server = uri.replace(/^ws(s?):/, "http$1:");
  const args = ["publish", "--server", server, "--module-path", MODULE_PATH, "--delete-data", "--yes", database];
  // The installer puts the CLI in ~/.local/bin, which is not always on a non-interactive PATH.
  const PATH = [process.env.PATH, join(homedir(), ".local", "bin")].filter(Boolean).join(delimiter);
  return new Promise((resolve, reject) => {
    execFile("spacetime", args, { env: { ...process.env, PATH }, timeout: 180_000 }, (err, _stdout, stderr) => {
      if (err) {
        const missing = (err as NodeJS.ErrnoException).code === "ENOENT" ? "spacetime CLI not found; " : "";
        reject(new Error(
          `publishTestDb(${database}) failed: ${missing}is the local server running at ${server}? ` +
          `Start it with \`npm run stdb:start\`.\n${stderr || err.message}`,
        ));
        return;
      }
      resolve({ uri, database });
    });
  });
}

/**
 * Simulates a dropped connection: closes the socket underneath `conn` without `conn.disconnect()`, so the SDK sees the
 * same close event a server restart or network loss produces. Reaches into the SDK's private `ws` field.
 */
export function dropConnection(conn: object): void {
  const ws = (conn as { ws?: { close(): void } }).ws;
  if (!ws) throw new Error("dropConnection: connection has no open socket");
  ws.close();
}
