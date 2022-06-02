// node
// vendors
// project
import { bridge } from "@podman-desktop-companion/container-app";
import { createWorkerClient } from "@podman-desktop-companion/rpc";
import { createLogger } from "@podman-desktop-companion/logger";

// locals
const { Application } = bridge.application;
const logger = createLogger("worker.js");
let app: any; // singleton - do not move into function

export default createWorkerClient(globalThis as any, async (ctx: any, message: any) => {
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
});
