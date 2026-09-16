import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./hooks/useAuth";
import "./index.css";
import { startTelemetryShipper } from "./utils/telemetryShipper";

// Started at the entry point rather than inside a component: telemetry should
// cover boot and the auth flow, which is where the interesting failures are,
// and it must not restart when React re-renders.
startTelemetryShipper();

ReactDOM.createRoot(document.getElementById("root")).render(
  <AuthProvider>
    <App />
  </AuthProvider>,
);
