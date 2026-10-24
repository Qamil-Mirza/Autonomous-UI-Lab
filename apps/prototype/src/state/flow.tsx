import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";

export type Plan = "free" | "pro";

// In-memory answers carried between screens so the confirm summary reflects them. Not run state.
export interface FlowState {
  name: string;
  email: string;
  password: string;
  consent: boolean;
  workspace: string;
  plan: Plan | null;
  inviteEmail: string;
}

const initial: FlowState = { name: "", email: "", password: "", consent: false, workspace: "", plan: null, inviteEmail: "" };

const FlowContext = createContext<{ flow: FlowState; update: (patch: Partial<FlowState>) => void } | null>(null);

export function FlowProvider({ children }: { children: ReactNode }) {
  const [flow, setFlow] = useState(initial);
  const update = useCallback((patch: Partial<FlowState>) => setFlow((f) => ({ ...f, ...patch })), []);
  return <FlowContext.Provider value={{ flow, update }}>{children}</FlowContext.Provider>;
}

export function useFlow() {
  const ctx = useContext(FlowContext);
  if (!ctx) throw new Error("useFlow must be used inside FlowProvider");
  return ctx;
}

export type Screen = "signup" | "workspace" | "plan" | "invite" | "confirm";

// Path of another screen within the current design version.
export function useScreenPath(): (screen: Screen) => string {
  const { versionId = "" } = useParams();
  return useCallback((screen: Screen) => `/v/${versionId}/${screen}`, [versionId]);
}

// Navigates to another screen within the current design version.
export function useGo() {
  const navigate = useNavigate();
  const pathTo = useScreenPath();
  return useCallback((screen: Screen) => navigate(pathTo(screen)), [navigate, pathTo]);
}
