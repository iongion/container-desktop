// vendors
// project
const { getLevel, setLevel, createLogger } = require("@podman-desktop-companion/logger");
const userSettings = require("@podman-desktop-companion/user-settings");
const { Application } = require("@podman-desktop-companion/container-client").application;
// locals
const logger = createLogger("shell.ipc");
let application;
const getApp = () => {
  if (!application) {
    application = new Application(process.env.REACT_APP_PROJECT_VERSION, process.env.REACT_APP_ENV);
  }
  return application;
};

const servicesMap = {
  "/start": async function (options) {
    return await getApp().start(options);
  },
  "/connect": async function (options) {
    return await getApp().connect(options);
  },
  "/container/engine/request": async function (options) {
    let result = {
      ok: false,
      data: undefined,
      headers: [],
      status: 500,
      statusText: "API request error"
    };
    try {
      const response = await application.createApiRequest(options);
      result = {
        ok: response.status >= 200 && response.status < 300,
        data: response.data,
        headers: response.headers,
        status: response.status,
        statusText: response.statusText
      };
    } catch (error) {
      if (error.response) {
        result = {
          ok: false,
          data: error.response.data,
          headers: error.response.headers,
          status: error.response.status,
          statusText: error.response.statusText
        };
      } else {
        result.statusText = error.message || "API request error";
      }
    }
    return result;
  },
  "/user/preferences/get": async function () {
    const app = await getApp();
    return await app.getUserPreferences();
  },
  "/user/preferences/set": async function ({ options }) {
    const app = await getApp();
    return await app.setUserPreferences(options);
  },
  "/system/info": async function () {
    const app = await getApp();
    return app.getSystemInfo();
  },
  "/system/prune": async function () {
    const app = await getApp();
    return app.pruneSystem();
  },
  "/system/reset": async function () {
    const app = await getApp();
    return app.resetSystem();
  },
  "/container/connect": async function ({ Id }) {
    const app = await getApp();
    return app.connectToContainer(Id);
  },
  "/machines/list": async function () {
    const app = await getApp();
    return app.getMachines();
  },
  "/machine/restart": async function ({ Name }) {
    const app = await getApp();
    return app.restartMachine(Name);
  },
  "/machine/stop": async function ({ Name }) {
    const app = await getApp();
    return app.stopMachine(Name);
  },
  "/machine/connect": async function ({ Name }) {
    const app = await getApp();
    return app.connectToMachine(Name);
  },
  "/machine/remove": async function ({ Name, force }) {
    const app = await getApp();
    return app.removeMachine(Name, force);
  },
  "/machine/create": async function (opts) {
    const app = await getApp();
    return app.createMachine(opts);
  },
  "/test": async function (opts) {
    const result = await getApp().test(opts.subject, opts.payload);
    result.subject = opts.subject;
    return result;
  },
  "/find.program": async function (opts) {
    const result = await application.findProgram(opts);
    return result;
  }
};

module.exports = {
  invoker: {
    invoke: async (method, params) => {
      let reply = {
        success: false,
        result: undefined,
        warnings: []
      };
      const service = servicesMap[method];
      // logger.debug("Creating invocation", method, params);
      if (service) {
        try {
          // logger.debug("Invoking", method, params);
          reply.success = true;
          reply.result = await service(params);
        } catch (error) {
          const result = {
            error: "Service invocation error",
            method,
            params
          };
          if (error.response) {
            result.response = error.response;
          }
          logger.error("Service error", result, error.message, error.stack);
          reply.success = false;
          reply.result = result;
        }
      } else {
        const result = {
          error: "No such IPC method"
        };
        logger.error("Service error", result);
        reply.success = false;
        reply.result = result;
      }
      return reply;
    }
  }
};
