import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { isRunId } from "@ghostloop/prototype-adapter/validation";
import { Stage } from "../components/Stage";
import { initRun, postStep, type Step, type StepResult } from "../api/client";

const RunContext = createContext<string | null>(null);

function manualRunId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `run_manual_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function RunError({ message }: { message: string }) {
  return (
    <Stage step={null}>
      <div className="panel" role="alert" data-testid="run-error">
        <h1>Run unavailable</h1>
        <p>{message}</p>
      </div>
    </Stage>
  );
}

// Supplies the run every API call is scoped to, from ?run=. A supplied run is used as-is (the harness inits it);
// without one, a run_manual_* run is created and added to the URL so manual use keeps working.
export function RunProvider({ children }: { children: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const runParam = params.get("run");
  // Kept in a ref so StrictMode's double effect inits the same run rather than two.
  const manualId = useRef<string | null>(null);
  const [initFailed, setInitFailed] = useState(false);

  useEffect(() => {
    if (runParam !== null) return;
    const runId = (manualId.current ??= manualRunId());
    let cancelled = false;
    void initRun(runId).then((ok) => {
      if (cancelled) return;
      if (!ok) return setInitFailed(true);
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("run", runId);
          return next;
        },
        { replace: true },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [runParam, setParams]);

  if (runParam === null) {
    return initFailed ? <RunError message="Could not start a new run. Is the prototype server running?" /> : <Stage step={null} />;
  }
  if (!isRunId(runParam)) return <RunError message={`Invalid run id "${runParam}". Expected run_<letters, digits, _ or ->.`} />;
  return <RunContext.Provider value={runParam}>{children}</RunContext.Provider>;
}

export function useRunId(): string {
  const runId = useContext(RunContext);
  if (!runId) throw new Error("useRunId must be used inside RunProvider");
  return runId;
}

// Posts one screen's submit for the current run. Returns null when a submit is already in flight (ignored),
// and sets `failed` for non-validation failures so the screen can show the generic api-error alert.
export function useStep<F extends string>(step: Step) {
  const runId = useRunId();
  const inFlight = useRef(false);
  const [failed, setFailed] = useState(false);
  const send = useCallback(
    async (body: unknown): Promise<StepResult<F> | null> => {
      if (inFlight.current) return null;
      inFlight.current = true;
      setFailed(false);
      try {
        const result = await postStep<F>(runId, step, body);
        if (result.kind === "failed") setFailed(true);
        return result;
      } finally {
        inFlight.current = false;
      }
    },
    [runId, step],
  );
  return { send, failed };
}
