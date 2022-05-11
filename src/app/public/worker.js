// node
// vendors
// project
const { Application } = require("@podman-desktop-companion/container-client").application;
const { createWorkerClient } = require("@podman-desktop-companion/rpc");
const { createLogger } = require("@podman-desktop-companion/logger");
// locals
const logger = createLogger("worker.js");
let app; // singleton - do not move into function

module.exports = createWorkerClient(global, async (ctx, message) => {
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
  } catch (error) {
    logger.error("Worker done handler error", error.message, error.stack);
    await ctx.done(error);
  }
});
