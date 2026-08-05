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
    // DEV-only: window.__cdCodingAgentStore, so the Coding Agent spec can render a transcript without
    // starting a real container session.
    const { installCodingAgentProbe } = await import("@/web-app/stores/codingAgent");
    installCodingAgentProbe();
    // DEV-only: window.__cdPluginStore, so the Plugins spec can render a table of plugins against a stand-in
    // bridge client instead of installing real packages into a real container.
    const { installPluginStoreProbe } = await import("@/web-app/stores/pluginStore");
    installPluginStoreProbe();
    // MOCK-only: bring up the scripted pi session so the Assistant, its cards and the approval gate are usable
    // without an engine. The real app has no session until one is started deliberately; this stands in for that.
    const { isMockMode } = await import("@/container-client/mock/mode");
    if (isMockMode()) {
      // MOCK-only: window.__cdMockKeyWrites, so a spec can prove WHICH secret a sign-in stored. The mock vault
      // answers `hasKey` true for every provider by design, so presence can never be the evidence.
      const { mockKeyWrites } = await import("@/ai-system/testing/aiMocks");
      (globalThis as { __cdMockKeyWrites?: typeof mockKeyWrites }).__cdMockKeyWrites = mockKeyWrites;
      const { useCodingAgentStore } = await import("@/web-app/stores/codingAgent");
      const { awaitHostRuntime } = await import("@/platform/provider");
      // The workspace has to be a HOST path, not the container's `/workspace`: the session header opens this folder
      // and hands it to VS Code, and `/workspace` exists only inside an agent container the mock never starts. The
      // home directory is the one directory certain to be there on any machine running the mock.
      //
      // Chained off the runtime rather than read here: nothing has registered one yet at this point in boot —
      // `startApplication()` does, after React mounts — so a synchronous read throws and takes the whole boot with it.
      void awaitHostRuntime()
        .then(async (runtime) => {
          // Only if nothing has started one meanwhile. This resolves AFTER React mounts, so anything that starts a
          // session in the meantime — a spec's own `start()`, or a user reaching the drawer first — would otherwise be
          // replaced by this one, and every read that follows the session's folder would answer for the wrong folder.
          if (useCodingAgentStore.getState().status !== "idle") return;
          await useCodingAgentStore.getState().start({
            connectionId: "mock-connection",
            workspacePath: await runtime.platform.getHomeDir(),
            modelId: "mock-assistant",
            upstreamBaseUrl: "",
            appVersion: "0.0.0",
          });
        })
        .catch((error) => {
          console.error("mock assistant session did not start", error);
        });
    }
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
