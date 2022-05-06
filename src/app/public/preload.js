const os = require("os");
// vendors
require("fix-path")();
const { contextBridge, ipcRenderer } = require("electron");
// project
const { createLogger } = require("@podman-desktop-companion/logger");
const { UserConfiguration } = require("@podman-desktop-companion/container-client").configuration;
// locals
const logger = createLogger("shell.preload");
const userConfiguration = new UserConfiguration(process.env.REACT_APP_PROJECT_VERSION, process.env.REACT_APP_ENV);

async function main() {
  logger.debug("Starting renderer process");
  process.once("loaded", () => {
    const context = {
      available: true,
      platform: os.type(),
      defaults: {
        connector: userConfiguration.getKey("connector.default")
      },
      application: {
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
        openDevTools: () => {
          logger.debug("Application openDevTools");
          try {
            ipcRenderer.send("openDevTools");
          } catch (error) {
            logger.error("Unable to openDevTools", error);
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
          try {
            const result = await ipcRenderer.invoke("proxy", req);
            // logger.debug(">> proxy to client", result);
            return result;
          } catch (error) {
            logger.error("Proxy invocation error", error.message, error.stack);
            throw new Error("Proxy invocation error");
          }
        }
      }
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
