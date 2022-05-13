// vendors
// require("fix-path")();
const { contextBridge, ipcRenderer } = require("electron");
// project
const { createLogger } = require("@podman-desktop-companion/logger");
const { createContext } = require("@podman-desktop-companion/container-app").bridge;
// locals
// Using worker to avoid users perceive the app as stuck during long operations
const { userConfiguration, osType, version, environment } = require("./configuration");

async function main() {
  const logger = createLogger("preload");
  logger.debug("Starting renderer process");
  process.once("loaded", () => {
    // Expose to application
    contextBridge.exposeInMainWorld(
      "nativeBridge",
      createContext({ ipcRenderer, userConfiguration, osType, version, environment })
    );
  });
  // Wait for window to bbe ready
  window.addEventListener("DOMContentLoaded", () => {
    const replaceText = (selector, text) => {
      const element = document.getElementById(selector);
      if (element) element.innerText = text;
    };
    for (const type of ["chrome", "node", "electron"]) {
      replaceText(`${type}-version`, process.versions[type]);
    }
  });
}

main();
