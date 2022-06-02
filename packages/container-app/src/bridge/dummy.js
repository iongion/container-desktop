// vendors
const { createLogger } = require("@podman-desktop-companion/logger");
// locals
const logger = createLogger("bridge.dummy");

const dummyFunction = async (currentApi, options) => {
  logger.debug("Dummy function call");
  return true;
};

function createActions(context, { ipcRenderer, userConfiguration, osType, version, environment }) {
  // Do not access the context at creation - it is lazy
  return {
    dummyFunction: (...rest) => dummyFunction(context.getCurrentApi(), ...rest)
  };
}

module.exports = {
  dummyFunction,
  createActions
};
