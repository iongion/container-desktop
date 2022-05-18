// project
const detector = require("@podman-desktop-companion/detector");
const { Podman } = require("@podman-desktop-companion/container-client").adapters;
// vendors
const { createLogger } = require("@podman-desktop-companion/logger");
// locals
const logger = createLogger("bridge.program");

const findProgram = async (engines, opts) => {
  const engine = engines.find((it) => it.id === opts.id);
  if (!engine) {
    logger.error("Unable to find a matching engine", opts.id);
    throw new Error("Find failed - no engine");
  }
  try {
    const result = await engine.getScopedCommand(undefined, undefined, { scope: opts.scope });
    const wrapper = { launcher: result.launcher, args: result.command.slice(0, 2) };
    const detect = await detector.findProgram(opts.program, { wrapper: { ...wrapper } });
    return detect;
  } catch (error) {
    logger.error("Unable to find program", error.message, error.stack);
  }
};

function createActions(context, { ipcRenderer, userConfiguration, osType, version, environment }) {
  // Do not access the context at creation - it is lazy
  return {
    findProgram: (...rest) => findProgram(context.getEngines(), ...rest)
  };
}

module.exports = {
  findProgram,
  createActions
};
