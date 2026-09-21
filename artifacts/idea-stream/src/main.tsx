import { setBaseUrl } from "@workspace/api-client-react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { ErrorBoundary } from "@/components/error-boundary";

import "./index.css";

setBaseUrl(import.meta.env.BASE_URL.replace(/\/$/, ""));

// Development never installs a worker, avoiding stale source files during HMR.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}recorder-sw.js`, {
        scope: import.meta.env.BASE_URL,
      })
      .catch((error) =>
        console.warn(
          "Offline app shell unavailable; local audio storage still works.",
          error,
        ),
      );
  });
}

createRoot(document.getElementById("root")!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
