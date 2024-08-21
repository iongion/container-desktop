// project
import { launchTerminal } from "@/terminal";
// vendors
import { ActionContext, ActionsEnvironment } from "@/container-app/bridge/types";
import { createLogger } from "@/logger";
// locals
const logger = await createLogger("bridge.connect");

export const connectToContainer = async (currentApi, opts?: any) => {
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

export function createActions(context: ActionContext, env: ActionsEnvironment) {
  // Do not access the context at creation - it is lazy
  return {
    connectToContainer: (...rest) => connectToContainer(context.getCurrentApi(), ...(rest as []))
  };
}

export default {
  connectToContainer,
  createActions
};
