// Renderer entry. A single window loads this bundle: the main app. (The tray is a native OS menu built in
// the main process — there is no tray renderer.) Global CSS is imported here.

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
  const { renderApplication } = await import("./App.render");
  bootTimeline.mark("app-render-imported");
  renderApplication();
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
