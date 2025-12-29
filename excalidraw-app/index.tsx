import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";

import "../excalidraw-app/sentry";

import ExcalidrawApp from "./App";
import { Dashboard } from "./components/Dashboard/Dashboard";
import { CanvasManager } from "./data/CanvasManager";
import { Provider } from "./app-jotai";

import "./index.scss";

window.__EXCALIDRAW_SHA__ = import.meta.env.VITE_APP_GIT_SHA;

const AppRouter = () => {
  const [route, setRoute] = useState(window.location.pathname);
  const [canvasId, setCanvasId] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    // Initialize canvas manager and get active canvas
    CanvasManager.initialize().then((id) => {
      // Check URL for canvas param
      const params = new URLSearchParams(window.location.search);
      const urlCanvasId = params.get("canvas");

      if (urlCanvasId) {
        setCanvasId(urlCanvasId);
        CanvasManager.setActiveCanvasId(urlCanvasId);
      } else {
        setCanvasId(id);
      }
      setInitialized(true);
    });

    // Handle browser navigation
    const handlePopState = () => {
      setRoute(window.location.pathname);
      const params = new URLSearchParams(window.location.search);
      const urlCanvasId = params.get("canvas");
      if (urlCanvasId) {
        setCanvasId(urlCanvasId);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigateTo = (path: string) => {
    window.history.pushState({}, "", path);
    setRoute(new URL(path, window.location.origin).pathname);

    const params = new URLSearchParams(new URL(path, window.location.origin).search);
    const urlCanvasId = params.get("canvas");
    if (urlCanvasId) {
      setCanvasId(urlCanvasId);
      CanvasManager.setActiveCanvasId(urlCanvasId);
    }
  };

  const handleCanvasSelect = (id: string) => {
    CanvasManager.setActiveCanvasId(id);
    setCanvasId(id);
    navigateTo(`/?canvas=${id}`);
  };

  if (!initialized) {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        background: "var(--color-surface-lowest, #1e1e1e)",
      }}>
        <div style={{
          width: 40,
          height: 40,
          border: "3px solid #333",
          borderTopColor: "#6965db",
          borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
        }} />
      </div>
    );
  }

  // Dashboard route
  if (route === "/dashboard") {
    return (
      <Provider>
        <Dashboard onCanvasSelect={handleCanvasSelect} />
      </Provider>
    );
  }

  // Main app with canvas
  return <ExcalidrawApp canvasId={canvasId} onNavigateToDashboard={() => navigateTo("/dashboard")} />;
};

const rootElement = document.getElementById("root")!;
const root = createRoot(rootElement);
registerSW();
root.render(
  <StrictMode>
    <AppRouter />
  </StrictMode>,
);
