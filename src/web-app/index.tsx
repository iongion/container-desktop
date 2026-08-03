// Renderer entry. A single window loads this bundle: the main app. (The tray is a native OS menu built by the
// native backend — there is no tray renderer.) Global CSS is imported here.

import type { LoggerBackend } from "@/logger";
import { bootTimeline } from "./bootTimeline";
import "./index.css";
// Cascade order: universal → tokens (semantic palette + Blueprint bridge + shared structure)
// → theme-only (dark/light) → engine-specific (docker/podman). Specificity rises in the same
// order, so engine rules win over theme rules win over shared structure win over universal.
import "./themes/shared.css";
import "./themes/tokens.css";
import "./themes/dark.css";
import "./themes/light.css";
import "./themes/docker.css";
import "./themes/podman.css";

const rootEl = document.getElementById("root");

async function boot() {
  bootTimeline.mark("script-start");
  // Shell selection: install the matching host bridge (the window.* globals, backed by the native Go/Rust
  // ports) before rendering. Wails is checked FIRST — both shells set window.Preloaded, so each detector keys
  // off its own marker to stay exclusive.
  const { isWailsRuntime } = await import("@/platform/wails/detect");
  const { isTauriRuntime } = await import("@/platform/tauri/detect");
  let loggerBackend: LoggerBackend | undefined;
  if (isWailsRuntime()) {
    const { installWailsHostBridge } = await import("@/platform/wails/bridge");
    await installWailsHostBridge();
    bootTimeline.mark("wails-bridge-installed");
    // Symmetric to the Tauri backend: route the façade's persisted records to the Wails log backend
    // (a Phase-1 no-op until the Go LogService lands). Dynamic so it never loads under the other shells.
    const { wailsLogBackend } = await import("@/platform/wails/log/wailsLog");
    loggerBackend = wailsLogBackend;
  } else if (isTauriRuntime()) {
    const { installTauriHostBridge } = await import("@/platform/tauri/bridge");
    await installTauriHostBridge();
    bootTimeline.mark("tauri-bridge-installed");
    // Symmetric to the Wails backend above: route the façade's persisted records to the native Rust
    // file sink (@tauri-apps/plugin-log). Dynamic so plugin-log never loads under Wails.
    const { tauriLogBackend } = await import("@/platform/tauri/log/tauriLog");
    loggerBackend = tauriLogBackend;
  } else {
    throw new Error("No supported desktop host runtime detected");
  }
  if (import.meta.env.DEV) {
    // DEV-only: expose window.__assistantDemo.seed() to load a synthetic transcript so the assistant's
    // rendering can be exercised without a live model. Dynamic import → tree-shaken from production.
    const { installAssistantDemo } = await import("@/web-app/components/ai/assistantDemo");
    installAssistantDemo();
    // DEV-only: window.__cdLiveProbe, the real-engine probes the WebDriver live specs drive. They run against
    // whichever shell installed the host globals, so one probe covers both backends.
    const { installLiveProbes } = await import("@/web-app/liveProbes");
    installLiveProbes();
  }
  const { renderApplication } = await import("./App.render");
  bootTimeline.mark("app-render-imported");
  renderApplication({ loggerBackend });
}

boot().catch((error) => {
  console.error("Render entry bootstrap failure", error);
  if (!rootEl) {
    return;
  }
  // Build the fallback via the DOM with textContent (never innerHTML) so an error message/stack can't inject markup.
  const container = document.createElement("div");
  container.style.cssText = "padding:2rem;font-family:system-ui;color:#cd4246;background:#1a051c;min-height:100vh;";
  const heading = document.createElement("h2");
  heading.textContent = "Application failed to start";
  const details = document.createElement("pre");
  details.style.cssText = "white-space:pre-wrap;word-break:break-word;";
  details.textContent = String(error?.stack || error);
  container.append(heading, details);
  rootEl.replaceChildren(container);
});
