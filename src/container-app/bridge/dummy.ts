// vendors
import { ActionContext, ActionsEnvironment } from "@/container-app/bridge/types";
import { createLogger } from "@/logger";
// locals
const logger = await createLogger("bridge.dummy");

export const dummyFunction = async (currentApi, options?: any) => {
  logger.debug("Dummy function call");
  return true;
};

export function createActions(context: ActionContext, env: ActionsEnvironment) {
  // Do not access the context at creation - it is lazy
  return {
    dummyFunction: (...rest) => dummyFunction(context.getCurrentApi(), ...(rest as []))
  };
}

export default {
  dummyFunction,
  createActions
};
