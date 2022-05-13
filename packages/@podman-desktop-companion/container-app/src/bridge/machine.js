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
async function restartMachine(currentEngine, opts) {
  const stop = await stopMachine(currentEngine, opts);
  const start = await startMachine(currentEngine, opts);
  return start.success;
}
async function startMachine(currentEngine, { Name }) {
  const { program } = await currentEngine.getCurrentSettings();
  const check = await currentEngine.runScopedCommand(program.path, ["machine", "start", Name], {
    async: true
  });
  return check.success;
}
async function stopMachine(currentEngine, { Name }) {
  const { program } = await currentEngine.getCurrentSettings();
  const check = await currentEngine.runScopedCommand(program.path, ["machine", "stop", Name]);
  return check.success;
}
async function removeMachine(currentEngine, opts) {
  const stopped = await stopMachine(currentEngine, opts);
  if (!stopped) {
    logger.warn("Unable to stop machine before removal");
    return false;
  }
  const { program } = await currentEngine.getCurrentSettings();
  const check = await currentEngine.runScopedCommand(program.path, ["machine", "rm", opts.Name, "--force"]);
  return check.success;
}
async function inspectMachine(currentEngine, Name) {
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

function createMachineActions(scope) {
  return {
    connectToMachine: (...rest) => connectToMachine(scope.getCurrentEngine(), ...rest),
    restartMachine: (...rest) => restartMachine(scope.getCurrentEngine(), ...rest),
    startMachine: (...rest) => startMachine(scope.getCurrentEngine(), ...rest),
    stopMachine: (...rest) => stopMachine(scope.getCurrentEngine(), ...rest),
    removeMachine: (...rest) => removeMachine(scope.getCurrentEngine(), ...rest),
    inspectMachine: (...rest) => inspectMachine(scope.getCurrentEngine(), ...rest),
    createMachine: (...rest) => createMachine(scope.getCurrentEngine(), ...rest)
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
  createMachineActions
};
