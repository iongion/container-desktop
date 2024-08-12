// node
// vendors
// project
import { bridge } from "@/container-app";
import { createLogger } from "@/logger";
import { createWorkerClient } from "@/rpc";

// locals
const { Application } = ((bridge as any) || {}).application || { Application: null };
const logger = createLogger("worker.mjs");
let app: any; // singleton - do not move into function

export default createWorkerClient(
  // scope
  globalThis as any,
  async (ctx: any, message: any) => {
    const configuration = message.context.configuration;
    if (app) {
      logger.debug("Reusing application instance", message.context);
    } else {
      logger.debug("Creating application instance", message.context);
      app = new Application({
        version: configuration.version,
        environment: configuration.environment,
        osType: configuration.osType,
        // Avoid detecting
        inited: message.context.inited,
        started: message.context.started,
        connectors: message.context.connectors || [],
        currentConnector: message.context.currentConnector
      });
    }
    logger.debug("Performing invocation", message.payload);
    const result = await app.invoke(message.payload.method, message.payload.params);
    try {
      await ctx.done(null, result);
    } catch (error: any) {
      logger.error("Worker done handler error", error.message, error.stack);
      await ctx.done(error);
    }
  },
  "shell-worker"
);
