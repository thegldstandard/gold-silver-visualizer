import React from "react";

import "./index.css";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary><div className="app"><div className="app"><div className="app"><div className="app"><App /></div></div></div></div></ErrorBoundary>
  </React.StrictMode>
);



