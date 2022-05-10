// vendors
// project
const { createWorkerClient } = require("@podman-desktop-companion/rpc");
const { Application } = require("@podman-desktop-companion/container-client").application;
// locals
let app; // singleton - do not move into function

module.exports = createWorkerClient(global, async (ctx, message) => {
  if (!app) {
    app = new Application(message.context.version, message.context.environment, message.context.osType);
  }
  const result = await app.invoke(message.payload.method, message.payload.params);
  return await ctx.done(null, result);
});
