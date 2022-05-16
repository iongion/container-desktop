// project
const { createLogger } = require("@podman-desktop-companion/logger");
// locals
const logger = createLogger("bridge.controller");

const getControllerScopes = async (currentApi, options) => {
  if (!currentApi.engine) {
    logger.error("No current engine");
    return [];
  }
  logger.debug("Listing controller scopes of current engine", currentApi.engine);
  return await currentApi.engine.getControllerScopes();
};

function createActions(context, { ipcRenderer, userConfiguration, osType, version, environment }) {
  // Do not access the context at creation - it is lazy
  return {
    getControllerScopes: (...rest) => getControllerScopes(context.getCurrentApi(), ...rest)
  };
}

module.exports = {
  getControllerScopes,
  createActions
};
