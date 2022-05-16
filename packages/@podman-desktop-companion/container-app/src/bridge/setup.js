// vendors
const { createLogger } = require("@podman-desktop-companion/logger");
// locals
const logger = createLogger("bridge.setup");

const setup = async (currentApi, options) => {
  logger.debug("Setup");
  return { logger: createLogger("shell.ui") };
};

function createActions(context, { ipcRenderer, userConfiguration, osType, version, environment }) {
  // Do not access the context at creation - it is lazy
  return {
    setup: (...rest) => setup(context.getCurrentApi(), ...rest)
  };
}

module.exports = {
  setup,
  createActions
};
