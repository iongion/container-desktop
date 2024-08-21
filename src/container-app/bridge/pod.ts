// project
// vendors
import { ActionContext, ActionsEnvironment } from "@/container-app/bridge/types";
import { createLogger } from "@/logger";
// locals
const logger = await createLogger("bridge.pod");

export const getPodLogs = async (currentApi, id?: any, tail?: any) => {
  logger.debug("Retrieving pod logs", id, tail);
  const { program } = await currentApi.engine.getCurrentSettings();
  const args = ["pod", "logs"];
  if (typeof tail !== "undefined") {
    args.push(`--tail=${tail}`);
  }
  args.push("-f", id);
  const result = await currentApi.engine.runScopedCommand(program.path, args);
  return result;
};

export function createActions(context: ActionContext, env: ActionsEnvironment) {
  // Do not access the context at creation - it is lazy
  return {
    getPodLogs: (...rest) => getPodLogs(context.getCurrentApi(), ...(rest as []))
  };
}

export default {
  getPodLogs,
  createActions
};
