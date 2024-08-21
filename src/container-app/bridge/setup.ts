// vendors
import { ActionContext, ActionsEnvironment } from "@/container-app/bridge/types";
import { createLogger } from "@/logger";
// locals
const logger = await createLogger("bridge.setup");

export const setup = async (currentApi, options?: any) => {
  logger.debug("Setup");
  return { logger: createLogger("shell.ui") };
};

export function createActions(context: ActionContext, env: ActionsEnvironment) {
  // Do not access the context at creation - it is lazy
  return {
    setup: (...rest) => setup(context.getCurrentApi(), ...(rest as []))
  };
}

export default {
  setup,
  createActions
};
