import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import type { PresentedElement, StyleToken } from "@ghostloop/design-engine";
import { Stage } from "../components/Stage";
import type { ElementId } from "./ids";
import { loadManifest } from "./load";

type Elements = ReadonlyMap<string, PresentedElement>;

type LoadState =
  | { versionId: string; status: "loading" }
  | { versionId: string; status: "ready"; elements: Elements }
  | { versionId: string; status: "error"; message: string };

const ManifestContext = createContext<Elements | null>(null);

export function ManifestProvider({ children }: { children: ReactNode }) {
  const { versionId = "" } = useParams();
  const [state, setState] = useState<LoadState>({ versionId, status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ versionId, status: "loading" });
    loadManifest(versionId).then(
      (m) => {
        if (!cancelled) setState({ versionId, status: "ready", elements: new Map(m.elements.map((el) => [el.elementId, el])) });
      },
      (err: unknown) => {
        if (!cancelled) setState({ versionId, status: "error", message: err instanceof Error ? err.message : String(err) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [versionId]);

  if (state.versionId !== versionId || state.status === "loading") {
    return <Stage step={null} />;
  }
  if (state.status === "error") {
    return (
      <Stage step={null}>
        <div className="panel" role="alert" data-testid="manifest-error">
          <h1>Design version unavailable</h1>
          <p>{state.message}</p>
        </div>
      </Stage>
    );
  }
  return <ManifestContext.Provider value={state.elements}>{children}</ManifestContext.Provider>;
}

export interface El {
  testId: string;
  label: string;
  visible: boolean;
  order: number;
  styleToken: StyleToken | undefined;
}

function toEl(el: PresentedElement): El {
  return {
    testId: el.elementId,
    label: el.label ?? "",
    visible: el.visible ?? true,
    order: el.order ?? Number.MAX_SAFE_INTEGER,
    styleToken: el.styleToken,
  };
}

function useElements(): Elements {
  const elements = useContext(ManifestContext);
  if (!elements) throw new Error("useEl must be used inside ManifestProvider");
  return elements;
}

export function useEl(id: ElementId): El {
  const el = useElements().get(id);
  // loadManifest guarantees every ElementId is present
  if (!el) throw new Error(`Manifest has no element ${id}`);
  return toEl(el);
}

// Returns the given IDs that are visible, sorted by manifest order (ties keep the given order).
export function useOrdered<T extends ElementId>(ids: readonly T[]): T[] {
  const elements = useElements();
  return ids
    .map((id, index) => ({ id, index, el: elements.get(id) }))
    .filter(({ el }) => el !== undefined && el.visible !== false)
    .sort((a, b) => (a.el?.order ?? Infinity) - (b.el?.order ?? Infinity) || a.index - b.index)
    .map(({ id }) => id);
}

export function tokenClass(token: StyleToken | undefined): string | undefined {
  return token ? `tok-${token.replace(".", "-")}` : undefined;
}
