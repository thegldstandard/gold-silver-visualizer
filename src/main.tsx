import './index.css';
import './index.css';
import './index.css';
import './index.css';
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { ErrorBoundary } from "./ErrorBoundary";
import App from "./App";

function installGlobalErrorHooks() {
  window.addEventListener("error", (e) => {
    console.error("window.error:", e.error || e.message || e);
  });
  window.addEventListener("unhandledrejection", (e) => {
    console.error("unhandledrejection:", e.reason);
  });
}
installGlobalErrorHooks();

const rootEl = document.getElementById("root");
if (!rootEl) {
  const msg = "Root element not found (id='root').";
  document.body.innerHTML = `<pre style="padding:16px">${msg}</pre>`;
  throw new Error(msg);
}

ReactDOM.createRoot(rootEl).render(
  <ErrorBoundary>
    <div className="app">
      {/* Visible banner so we know React mounted even if App fails */}
      <div style={{
        marginBottom: 10, padding: "8px 10px",
        background: "#1e232b", color: "#e8ecf1",
        border: "1px solid #33404e", borderRadius: 10,
        fontFamily: "system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial", fontSize: 13
      }}>
        App shell mounted — if the screen turns blank after this line, App is throwing.
        Check Console for errors (we hooked window.error and unhandledrejection).
      </div>
      <App />
    </div>
  </ErrorBoundary>
);

