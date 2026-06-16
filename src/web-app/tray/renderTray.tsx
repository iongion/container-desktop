// Entry for the tray popover window (loaded via index.html#tray). Minimal provider tree — no
// QueryClient/Application bootstrap, no events stream. Dynamically imported by index.tsx so the
// full-app module graph is never executed in this window.

import { HotkeysProvider } from "@blueprintjs/core";
import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";

import { TrayApp } from "./TrayApp";
import "./tray.css";

export function renderTray() {
  const container = document.getElementById("root");
  if (!container) {
    return;
  }
  createRoot(container).render(
    <HotkeysProvider>
      <HelmetProvider>
        <TrayApp />
      </HelmetProvider>
    </HotkeysProvider>,
  );
}
