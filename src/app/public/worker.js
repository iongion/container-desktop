// vendors
// project
const { Application } = require("@podman-desktop-companion/container-client").application;
// locals
let app;

module.exports = {
  invoker: {
    invoke: async (method, params, context) => {
      if (!app) {
        app = new Application(context.version, context.environment, context.osType);
      }
      return await app.invoke(method, params);
    }
  }
};
