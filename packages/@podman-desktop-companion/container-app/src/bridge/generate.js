// project
const { Podman } = require("@podman-desktop-companion/container-client").adapters;
// vendors
const { createLogger } = require("@podman-desktop-companion/logger");
// locals
const logger = createLogger("bridge.generate");

const generateKube = async (currentApi, entityId) => {
  const capable = currentApi.engine.ADAPTER === Podman.Adapter.ADAPTER;
  if (!capable) {
    logger.error("Current engine is not able to generate kube yaml", currentApi.engine.ADAPTER, Podman.Adapter.ADAPTER);
    return null;
  }
  const { program } = await currentApi.engine.getCurrentSettings();
  const result = await currentApi.engine.runScopedCommand(program.path, ["generate", "kube", entityId]);
  if (!result.success) {
    logger.error("Unable to generate kube", entityId, result);
  }
  return result;
};

function createActions(context, { ipcRenderer, userConfiguration, osType, version, environment }) {
  // Do not access the context at creation - it is lazy
  return {
    generateKube: (...rest) => generateKube(context.getCurrentApi(), ...rest)
  };
}

module.exports = {
  generateKube,
  createActions
};
