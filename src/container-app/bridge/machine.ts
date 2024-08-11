import { createLogger } from "@/logger";
import { launchTerminal } from "@/terminal";
// local
const logger = createLogger("bridge.machine");
// machines
export async function connectToMachine(currentEngine, name?: any, title?: any) {
  logger.debug("Connecting to machine", name, title);
  const { launcher, command } = await currentEngine.getScopedCommand("/bin/sh", []);
  logger.debug("Launching terminal for", { launcher, command });
  const output = await launchTerminal(launcher, command, {
    title: title || `${currentEngine.ADAPTER} machine`
  });
  if (!output.success) {
    logger.error("Unable to connect to machine", name, title, output);
  }
  return output.success;
}
export async function restartMachine(currentEngine, name?: any) {
  const stop = await stopMachine(currentEngine, name);
  const start = await startMachine(currentEngine, name);
  return start.success;
}
export async function startMachine(currentEngine, name?: any) {
  const { program } = await currentEngine.getCurrentSettings();
  const check = await currentEngine.runScopedCommand(program.path, ["machine", "start", name], {
    async: true
  });
  return check.success;
}
export async function stopMachine(currentEngine, name?: any) {
  const { program } = await currentEngine.getCurrentSettings();
  const check = await currentEngine.runScopedCommand(program.path, ["machine", "stop", name]);
  return check.success;
}
export async function removeMachine(currentEngine, name?: any) {
  const stopped = await stopMachine(currentEngine, name);
  if (!stopped) {
    logger.warn("Unable to stop machine before removal");
    return false;
  }
  const { program } = await currentEngine.getCurrentSettings();
  const check = await currentEngine.runScopedCommand(program.path, ["machine", "rm", name, "--force"]);
  return check.success;
}
export async function inspectMachine(currentEngine, name?: any) {
  const machines = await getMachines(currentEngine);
  return machines.find((it) => it.Name === name);
}
export async function createMachine(currentEngine, opts?: any) {
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
export async function getMachines(currentEngine) {
  logger.debug("Listing machines engine", currentEngine);
  if (currentEngine.ADAPTER !== "podman") {
    logger.debug("Only podman supports machines");
    return [];
  }
  return await currentEngine.getMachines();
}

export function createActions(context) {
  return {
    connectToMachine: (...rest) => connectToMachine(context.getCurrentApi()?.engine, ...(rest as [])),
    restartMachine: (...rest) => restartMachine(context.getCurrentApi()?.engine, ...(rest as [])),
    startMachine: (...rest) => startMachine(context.getCurrentApi()?.engine, ...(rest as [])),
    stopMachine: (...rest) => stopMachine(context.getCurrentApi()?.engine, ...(rest as [])),
    removeMachine: (...rest) => removeMachine(context.getCurrentApi()?.engine, ...(rest as [])),
    inspectMachine: (...rest) => inspectMachine(context.getCurrentApi()?.engine, ...(rest as [])),
    createMachine: (...rest) => createMachine(context.getCurrentApi()?.engine, ...(rest as [])),
    getMachines: (...rest) => getMachines(context.getCurrentApi()?.engine, ...(rest as []))
  };
}

export default {
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
