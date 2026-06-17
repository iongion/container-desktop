// Renderer entry. A single window loads this bundle: the main app. (The tray is a native OS menu built in
// the main process — there is no tray renderer.) Global CSS is imported here.

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

async function boot() {
  const { renderApplication } = await import("./App.render");
  renderApplication();
}

boot();
