// Renderer entry. A single window loads this bundle: the main app. (The tray is a native OS menu built in
// the main process — there is no tray renderer.) Global CSS is imported here.

import "./index.css";
import "./themes/docker.css";
import "./themes/podman.css";
import "./themes/shared.css";

async function boot() {
  const { renderApplication } = await import("./App.render");
  renderApplication();
}

boot();
