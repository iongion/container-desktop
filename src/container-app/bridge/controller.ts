// project
import { createLogger } from "@/logger";
// locals
const logger = createLogger("bridge.controller");

export const getControllerScopes = async (currentApi, options?: any) => {
  if (!currentApi.engine) {
    logger.error("No current engine");
    return [];
  }
  logger.debug("Listing controller scopes of current engine", currentApi.engine);
  return await currentApi.engine.getControllerScopes();
};

export function createActions(context, { ipcRenderer, userConfiguration, osType, version, environment }) {
  // Do not access the context at creation - it is lazy
  return {
    getControllerScopes: (...rest) => getControllerScopes(context.getCurrentApi(), ...(rest as []))
  };
}

export default {
  getControllerScopes,
  createActions
};
