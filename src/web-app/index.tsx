// Renderer entry. Two windows load this same bundle (the renderer build inlines dynamic imports
// into one file): the main app window, and the tray popover at index.html#tray. We branch on the
// hash and DYNAMICALLY import only the path we need, so the tray window never executes the
// full-app bootstrap (Application + events). Global CSS is imported here so both windows share it.

import "./index.css";
import "./themes/docker.css";
import "./themes/podman.css";
import "./themes/shared.css";

async function boot() {
  const isTray = window.location.hash.replace(/^#/, "").startsWith("tray");
  if (isTray) {
    const { renderTray } = await import("./tray/renderTray");
    renderTray();
  } else {
    const { renderApplication } = await import("./App.render");
    renderApplication();
  }
}

boot();
