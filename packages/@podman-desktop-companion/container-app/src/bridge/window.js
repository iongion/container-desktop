// project
const { createLogger } = require("@podman-desktop-companion/logger");
// locals
const logger = createLogger("bridge.window");

module.exports = {
  createActions: (context, { ipcRenderer }) => {
    return {
      minimize() {
        logger.debug("Application minimize");
        try {
          ipcRenderer.send("window.minimize");
        } catch (error) {
          logger.error("Unable to minimize", error);
        }
      },
      maximize() {
        logger.debug("Application maximize");
        try {
          ipcRenderer.send("window.maximize");
        } catch (error) {
          logger.error("Unable to maximize", error);
        }
      },
      restore() {
        logger.debug("Application restore");
        try {
          ipcRenderer.send("window.restore");
        } catch (error) {
          logger.error("Unable to restore", error);
        }
      },
      close() {
        logger.debug("Application close");
        try {
          ipcRenderer.send("window.close");
        } catch (error) {
          logger.error("Unable to close", error);
        }
      },
      exit() {
        logger.debug("Application exit");
        try {
          ipcRenderer.send("application.exit");
        } catch (error) {
          logger.error("Unable to exit", error);
        }
      },
      relaunch() {
        logger.debug("Application relaunch");
        try {
          ipcRenderer.send("application.relaunch");
        } catch (error) {
          logger.error("Unable to relaunch", error);
        }
      },
      openDevTools() {
        logger.debug("Application openDevTools");
        try {
          ipcRenderer.send("openDevTools");
        } catch (error) {
          logger.error("Unable to openDevTools", error);
        }
      },
      async openFileSelector(options) {
        logger.debug("Application openFileSelector", options);
        try {
          const result = await ipcRenderer.invoke("openFileSelector", options);
          return result;
        } catch (error) {
          logger.error("Unable to openFileSelector", error);
        }
      },
      async openTerminal(options) {
        logger.debug("Application openTerminal", options);
        try {
          const result = await ipcRenderer.invoke("openTerminal", options);
          return result;
        } catch (error) {
          logger.error("Unable to openTerminal", error);
        }
      }
    };
  }
};
