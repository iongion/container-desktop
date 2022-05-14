const { createLogger } = require("@podman-desktop-companion/logger");
const { launchTerminal } = require("@podman-desktop-companion/terminal");
// local
const logger = createLogger("bridge.machine");
// machines
async function connectToMachine(currentEngine, name, title) {
  logger.debug("Connecting to machine", name, title);
  const { launcher, command } = await currentEngine.getScopedCommand("/bin/sh", []);
  logger.debug("Launching terminal for", { launcher, command });
  const output = await launchTerminal(launcher, command, {
    title: title || `${currentEngine.ADAPTER} machine`
  });
  if (!output.success) {
    logger.error("Unable to connect to machine", id, output);
  }
  return output.success;
}
async function restartMachine(currentEngine, name) {
  const stop = await stopMachine(currentEngine, name);
  const start = await startMachine(currentEngine, name);
  return start.success;
}
async function startMachine(currentEngine, name) {
  const { program } = await currentEngine.getCurrentSettings();
  const check = await currentEngine.runScopedCommand(program.path, ["machine", "start", name], {
    async: true
  });
  return check.success;
}
async function stopMachine(currentEngine, name) {
  const { program } = await currentEngine.getCurrentSettings();
  const check = await currentEngine.runScopedCommand(program.path, ["machine", "stop", name]);
  return check.success;
}
async function removeMachine(currentEngine, name) {
  const stopped = await stopMachine(currentEngine, name);
  if (!stopped) {
    logger.warn("Unable to stop machine before removal");
    return false;
  }
  const { program } = await currentEngine.getCurrentSettings();
  const check = await currentEngine.runScopedCommand(program.path, ["machine", "rm", name, "--force"]);
  return check.success;
}
async function inspectMachine(currentEngine, name) {
  throw new Error("Not implemented");
}
async function createMachine(currentEngine, opts) {
  const { program } = await currentEngine.getCurrentSettings();
  const output = await currentEngine.runScopedCommand(program.path, [
    "machine",
    "init",
    "--cpus",
    opts.cpus,
    "--disk-size",
    opts.diskSize,
    "--memory",
    opts.ramSize,
    opts.name
  ]);
  if (!output.success) {
    logger.error("Unable to create machine", opts, output);
  }
  return output.success;
}
async function getMachines(currentEngine) {
  let machines = [];
  logger.debug("Listing machines engine", currentEngine);
  if (currentEngine.ADAPTER !== "podman") {
    logger.debug("Only podman supports machines");
    return [];
  }
  return await currentEngine.getMachines();
}

function createActions(context) {
  return {
    connectToMachine: (...rest) => connectToMachine(context.getCurrentApi()?.engine, ...rest),
    restartMachine: (...rest) => restartMachine(context.getCurrentApi()?.engine, ...rest),
    startMachine: (...rest) => startMachine(context.getCurrentApi()?.engine, ...rest),
    stopMachine: (...rest) => stopMachine(context.getCurrentApi()?.engine, ...rest),
    removeMachine: (...rest) => removeMachine(context.getCurrentApi()?.engine, ...rest),
    inspectMachine: (...rest) => inspectMachine(context.getCurrentApi()?.engine, ...rest),
    createMachine: (...rest) => createMachine(context.getCurrentApi()?.engine, ...rest),
    getMachines: (...rest) => getMachines(context.getCurrentApi()?.engine, ...rest)
  };
}

module.exports = {
  connectToMachine,
  restartMachine,
  startMachine,
  stopMachine,
  removeMachine,
  inspectMachine,
  createMachine,
  getMachines,
  createActions
};
