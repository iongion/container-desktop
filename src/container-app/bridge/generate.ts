// project
import { ActionContext, ActionsEnvironment } from "@/container-app/bridge/types";
import { adapters } from "@/container-client";
// vendors
import { createLogger } from "@/logger";
// locals
const { Podman } = adapters;
const logger = await createLogger("bridge.generate");

export const generateKube = async (currentApi, entityId?: any) => {
  const capable = currentApi.engine.ADAPTER === Podman.Adapter.ADAPTER;
  if (!capable) {
    logger.error("Current engine is not able to generate kube yaml", currentApi.engine.ADAPTER, Podman.Adapter.ADAPTER);
    return null;
  }
  const { program } = await currentApi.engine.getCurrentSettings();
  const result = await currentApi.engine.runScopedCommand(program.path, ["generate", "kube", entityId]);
  if (!result.success) {
    logger.error("Unable to generate kube", entityId, result);
  }
  return result;
};

export function createActions(context: ActionContext, env: ActionsEnvironment) {
  // Do not access the context at creation - it is lazy
  return {
    generateKube: (...rest) => generateKube(context.getCurrentApi(), ...(rest as []))
  };
}

export default {
  generateKube,
  createActions
};
