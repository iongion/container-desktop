// project
const { launchTerminal } = require("@podman-desktop-companion/terminal");
// vendors
const { createLogger } = require("@podman-desktop-companion/logger");
// locals
const logger = createLogger("bridge.connect");

const connectFunction = async (currentApi, opts) => {
  const { id, title, shell } = opts || {};
  logger.debug("Connecting to container", opts);
  const { program } = await currentApi.engine.getCurrentSettings();
  const { launcher, command } = await currentApi.engine.getScopedCommand(program.path, [
    "exec",
    "-it",
    id,
    shell || "/bin/sh"
  ]);
  logger.debug("Launching terminal for", { launcher, command });
  const output = await launchTerminal(launcher, command, {
    title: title || `${currentApi.engine.ADAPTER} container`
  });
  if (!output.success) {
    logger.error("Unable to connect to container", id, output);
  }
  return output.success;
};

function createActions(context, { ipcRenderer, userConfiguration, osType, version, environment }) {
  // Do not access the context at creation - it is lazy
  return {
    connectFunction: (...rest) => connectFunction(context.getCurrentApi(), ...rest)
  };
}

module.exports = {
  connectFunction,
  createActions
};
