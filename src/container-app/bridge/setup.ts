// vendors
import { createLogger } from "@/logger";
// locals
const logger = createLogger("bridge.setup");

export const setup = async (currentApi, options?: any) => {
  logger.debug("Setup");
  return { logger: createLogger("shell.ui") };
};

export function createActions(context, opts?: any) {
  const { ipcRenderer, userConfiguration, osType, version, environment } = opts || {};
  // Do not access the context at creation - it is lazy
  return {
    setup: (...rest) => setup(context.getCurrentApi(), ...(rest as []))
  };
}

export default {
  setup,
  createActions
};
