// vendors
// require("fix-path")();
const { contextBridge, ipcRenderer } = require("electron");
// project
const { createLogger } = require("@podman-desktop-companion/logger");
const { createWorkerGateway } = require("@podman-desktop-companion/rpc");
// locals
const { userConfiguration, osType, version, environment } = require("./configuration");
const { Application } = require("@podman-desktop-companion/container-client").application;
const { createApiDriver } = require("@podman-desktop-companion/container-client").api;
const logger = createLogger("shell.preload");
// Using worker to avoid users perceive the app as stuck during long operations

async function main() {
  logger.debug("Starting renderer process");
  process.once("loaded", () => {
    const context = {
      available: true,
      platform: osType,
      defaults: {
        connector: userConfiguration.getKey("connector.default"),
        // This must not fail - prevents startup failures to put the app in an undefined state
        descriptor: Application.getDefaultDescriptor({
          osType,
          version,
          environment
        })
      },
      application: {
        setup: function () {
          logger.error("Application setup");
          return { logger: createLogger("shell.ui") };
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
        proxy: async (req, ctx, opts) => {
          const gateway = createWorkerGateway(() => new Worker("worker.js"));
          // Inject configuration
          ctx.configuration = {
            osType,
            version,
            environment
          };
          return await gateway.invoke(req, ctx, opts);
        },
        proxyHTTPRequest: async (req) => {
          const driver = createApiDriver({
            baseURL: req.baseURL,
            socketPath: req.socketPath
          });
          let result;
          try {
            const response = await driver.request({
              method: req.method,
              url: req.url,
              params: req.params,
              data: req.data
            });
            result = {
              ok: response.status >= 200 && response.status <= 300,
              status: response.status,
              statusText: response.statusText,
              data: response.data,
              headers: response.headers
            };
          } catch (error) {
            if (error.response) {
              logger.error("Response error", error.message, error.stack);
              result = {
                ok: false,
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data,
                headers: error.response.headers
              };
            } else {
              logger.error("Request exception", error.message, error.stack);
              result = {
                ok: false,
                status: 500,
                statusText: "Request exception",
                data: undefined,
                headers: {}
              };
            }
          }
          return {
            result: result,
            success: result.ok,
            warnings: []
          };
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
