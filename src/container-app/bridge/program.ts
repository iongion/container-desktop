// project
import { ActionContext, ActionsEnvironment } from "@/container-app/bridge/types";
import { adapters } from "@/container-client";
import { findProgram as detectorFindProgram } from "@/detector";
// vendors
import { createLogger } from "@/logger";
// locals
const { Podman } = adapters;
const logger = await createLogger("bridge.program");

export const findProgram = async (engines, opts?: any) => {
  const engine = engines.find((it) => it.id === opts.id);
  if (!engine) {
    logger.error("Unable to find a matching engine", opts.id);
    throw new Error("Find failed - no engine");
  }
  try {
    const result = await engine.getScopedCommand(undefined, undefined, { scope: opts.scope });
    const wrapper = { launcher: result.launcher, args: result.command.slice(0, 2) };
    const detect = await detectorFindProgram(opts.program, { wrapper: { ...wrapper } });
    return detect;
  } catch (error: any) {
    logger.error("Unable to find program", error.message, error.stack);
  }
};

export function createActions(context: ActionContext, env: ActionsEnvironment) {
  // Do not access the context at creation - it is lazy
  return {
    findProgram: (...rest: any[]) => findProgram(context.getEngines(), ...(rest as []))
  };
}

export default {
  findProgram,
  createActions
};
