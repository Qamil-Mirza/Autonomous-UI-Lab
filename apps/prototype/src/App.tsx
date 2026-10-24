import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { ManifestProvider } from "./manifest/context";
import { FlowProvider } from "./state/flow";
import { Stage } from "./components/Stage";
import { Signup } from "./screens/Signup";
import { Workspace } from "./screens/Workspace";
import { Plan } from "./screens/Plan";
import { Invite } from "./screens/Invite";
import { Confirm } from "./screens/Confirm";

function VersionLayout() {
  return (
    <ManifestProvider>
      <FlowProvider>
        <Outlet />
      </FlowProvider>
    </ManifestProvider>
  );
}

function NotFound() {
  return (
    <Stage step={null}>
      <div className="panel" role="alert">
        <h1>Page not found</h1>
        <p>Open a screen as /v/&lt;versionId&gt;/signup.</p>
      </div>
    </Stage>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/v/ver_baseline/signup" replace />} />
        <Route path="/v/:versionId" element={<VersionLayout />}>
          <Route index element={<Navigate to="signup" replace />} />
          <Route path="signup" element={<Signup />} />
          <Route path="workspace" element={<Workspace />} />
          <Route path="plan" element={<Plan />} />
          <Route path="invite" element={<Invite />} />
          <Route path="confirm" element={<Confirm />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
