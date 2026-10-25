import { spawn } from "node:child_process";
import { ImportError } from "../errors";

export interface DockerResult {
  code: number | null;
  stdout: string;
  /** Combined output tail, capped at `maxOutputBytes`. */
  output: string;
  timedOut: boolean;
  cancelled: boolean;
  truncated: boolean;
}

export interface DockerRunOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Output kept in memory; the rest is dropped (the tail is kept). */
  maxOutputBytes?: number;
  onOutput?: (chunk: string) => void;
  /** Container to force-remove on timeout or cancellation (killing the CLI does not stop a container). */
  container?: string;
}

/**
 * Runs the Docker CLI with a hard timeout, cancellation and bounded output. On timeout or cancel the named
 * container is force-removed as well, because killing the client leaves the container running.
 */
export function docker(args: string[], opts: DockerRunOptions = {}): Promise<DockerResult> {
  const max = opts.maxOutputBytes ?? 256 * 1024;
  const DOCKER = process.env.GHOSTLOOP_DOCKER_BIN || "docker";
  return new Promise((resolve) => {
    // Never pass the host environment through: only what the CLI itself needs.
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME };
    for (const k of ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY"]) if (process.env[k]) env[k] = process.env[k];
    const child = spawn(DOCKER, args, { stdio: ["ignore", "pipe", "pipe"], env });
    let stdout = "";
    let output = "";
    let truncated = false;
    let timedOut = false;
    let cancelled = false;
    const append = (chunk: Buffer, isStdout: boolean) => {
      const s = chunk.toString("utf8");
      if (isStdout && stdout.length < max) stdout += s;
      output += s;
      if (output.length > max) {
        output = output.slice(output.length - max);
        truncated = true;
      }
      opts.onOutput?.(s);
    };
    child.stdout.on("data", (c: Buffer) => append(c, true));
    child.stderr.on("data", (c: Buffer) => append(c, false));
    const stop = () => {
      child.kill("SIGKILL");
      if (opts.container) spawn(DOCKER, ["rm", "-f", opts.container], { stdio: "ignore", env }).on("error", () => {});
    };
    const timer = opts.timeoutMs ? setTimeout(() => ((timedOut = true), stop()), opts.timeoutMs) : undefined;
    const onAbort = () => ((cancelled = true), stop());
    if (opts.signal?.aborted) onAbort();
    else opts.signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (err) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({ code: -1, stdout, output: `${output}\n${err.message}`, timedOut, cancelled, truncated });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({ code, stdout, output, timedOut, cancelled, truncated });
    });
  });
}

export const RUNTIME_HINT =
  "Imported apps are installed, built and previewed only inside Docker containers. Install Docker Desktop (or another Docker engine), start it, and retry. GhostLoop never runs uploaded code directly on this machine.";

/** Confirms a Docker engine is reachable; otherwise explains the setup requirement. Never falls back to the host. */
export async function requireDocker(): Promise<string> {
  const r = await docker(["version", "--format", "{{.Server.Version}}"], { timeoutMs: 10_000 });
  const version = r.stdout.trim();
  if (r.code !== 0 || !version) {
    const why = r.code === -1 ? "the docker command was not found" : r.timedOut ? "the Docker engine did not answer" : "the Docker engine is not running";
    throw new ImportError("RUNTIME_UNAVAILABLE", `The isolation runtime is unavailable: ${why}.`, RUNTIME_HINT);
  }
  return version;
}
