// project
import { ActionContext, ActionsEnvironment } from "@/container-app/bridge/types";
import { createLogger } from "@/logger";
// locals
const logger = await createLogger("bridge.window");

export function createActions(context: ActionContext, env: ActionsEnvironment) {
  const { ipcRenderer } = env;
  return {
    notify(message, payload) {
      logger.debug("Application notify", message, payload);
      try {
        ipcRenderer.send("notify", { message, payload });
      } catch (error: any) {
        logger.error("Unable to notify", error);
      }
    },
    minimize() {
      logger.debug("Application minimize");
      try {
        ipcRenderer.send("window.minimize");
      } catch (error: any) {
        logger.error("Unable to minimize", error);
      }
    },
    maximize() {
      logger.debug("Application maximize");
      try {
        ipcRenderer.send("window.maximize");
      } catch (error: any) {
        logger.error("Unable to maximize", error);
      }
    },
    restore() {
      logger.debug("Application restore");
      try {
        ipcRenderer.send("window.restore");
      } catch (error: any) {
        logger.error("Unable to restore", error);
      }
    },
    close() {
      logger.debug("Application close");
      try {
        ipcRenderer.send("window.close");
      } catch (error: any) {
        logger.error("Unable to close", error);
      }
    },
    exit() {
      logger.debug("Application exit");
      try {
        ipcRenderer.send("application.exit");
      } catch (error: any) {
        logger.error("Unable to exit", error);
      }
    },
    relaunch() {
      logger.debug("Application relaunch");
      try {
        ipcRenderer.send("application.relaunch");
      } catch (error: any) {
        logger.error("Unable to relaunch", error);
      }
    },
    openDevTools() {
      try {
        logger.debug("Application openDevTools");
        ipcRenderer.send("openDevTools");
      } catch (error: any) {
        logger.error("Unable to openDevTools", error);
      }
    },
    async openFileSelector(options) {
      logger.debug("Application openFileSelector", options);
      try {
        const result = await ipcRenderer.invoke("openFileSelector", options);
        return result;
      } catch (error: any) {
        logger.error("Unable to openFileSelector", error);
      }
    },
    async openTerminal(options) {
      logger.debug("Application openTerminal", options);
      try {
        const result = await ipcRenderer.invoke("openTerminal", options);
        return result;
      } catch (error: any) {
        logger.error("Unable to openTerminal", error);
      }
    }
  };
}

export default {
  createActions
};
