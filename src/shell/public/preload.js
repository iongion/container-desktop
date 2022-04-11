const os = require("os");
const path = require("path");
// vendors
require("fix-path")();
const { contextBridge, ipcRenderer } = require("electron");
const logger = require("electron-log");
// locals
const { getApiConfig, getApiDriver } = require("@podman-desktop-companion/container-client");
const { withWorkerRPC } = require("@podman-desktop-companion/rpc");

const application = {
  setup: function () {
    logger.debug("Application setup");
    return { logger };
  },
  minimize: () => {
    logger.debug("Application minimize");
    try {
      ipcRenderer.send("window.minimize");
    } catch (error) {
      logger.error("Unable to minimize", error);
    }
  },
  maximize: () => {
    logger.debug("Application maximize");
    try {
      ipcRenderer.send("window.maximize");
    } catch (error) {
      logger.error("Unable to maximize", error);
    }
  },
  restore: () => {
    logger.debug("Application restore");
    try {
      ipcRenderer.send("window.restore");
    } catch (error) {
      logger.error("Unable to restore", error);
    }
  },
  close: () => {
    logger.debug("Application close");
    try {
      ipcRenderer.send("window.close");
    } catch (error) {
      logger.error("Unable to close", error);
    }
  },
  exit: () => {
    logger.debug("Application exit");
    try {
      ipcRenderer.send("application.exit");
    } catch (error) {
      logger.error("Unable to exit", error);
    }
  },
  relaunch: () => {
    logger.debug("Application relaunch");
    try {
      ipcRenderer.send("application.relaunch");
    } catch (error) {
      logger.error("Unable to relaunch", error);
    }
  },
  openFileSelector: async (options) => {
    logger.debug("Application openFileSelector", options);
    try {
      const result = await ipcRenderer.invoke("openFileSelector", options);
      return result;
    } catch (error) {
      logger.error("Unable to openFileSelector", error);
    }
  },
  openTerminal: async (options) => {
    logger.debug("Application openTerminal", options);
    try {
      const result = await ipcRenderer.invoke("openTerminal", options);
      return result;
    } catch (error) {
      logger.error("Unable to openTerminal", error);
    }
  },
  proxy: async (req) => {
    if (os.type() === "Darwin") {
      // const result = await invoker.invoke(req.method, req.params);
      const result = await ipcRenderer.invoke("proxy", req);
      // logger.debug(">> proxy to client", result);
      return result;
    }
    process.env.WORKER_PROCESS_FILE = path.join(__dirname, "ipc.js");
    const result = await withWorkerRPC((rpc) => rpc.invoke(req));
    // logger.debug(">> proxy to client", result);
    return result;
  }
};

async function main() {
  logger.debug("Starting renderer process");
  process.once("loaded", () => {
    const config = getApiConfig();
    const context = {
      available: true,
      platform: os.type(),
      application,
      //
      containerApiConfig: config,
      containerApiDriver: getApiDriver(config)
    };
    // Expose to application
    contextBridge.exposeInMainWorld("nativeBridge", context);
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
