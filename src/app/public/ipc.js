// vendors
// project
const { createLogger } = require("@podman-desktop-companion/logger");
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
  "/global/user/settings/get": async function () {
    return await getApp().getGlobalUserSettings();
  },
  "/global/user/settings/set": async function ({ options }) {
    return await getApp().setGlobalUserSettings(options);
  },
  "/engine/user/settings/get": async function (id) {
    return await getApp().getEngineUserSettings(id);
  },
  "/engine/user/settings/set": async function (id, settings) {
    return await getApp().setEngineUserSettings(id, settings);
  },
  "/system/info": async function () {
    return await getApp().getSystemInfo();
  },
  "/system/prune": async function () {
    return await getApp().pruneSystem();
  },
  "/system/reset": async function () {
    return await getApp().resetSystem();
  },
  "/container/connect": async function ({ Id }) {
    return await getApp().connectToContainer(Id);
  },
  "/machines/list": async function () {
    return await getApp().getMachines();
  },
  "/machine/restart": async function ({ Name }) {
    return await getApp().restartMachine(Name);
  },
  "/machine/stop": async function ({ Name }) {
    return await getApp().stopMachine(Name);
  },
  "/machine/connect": async function ({ Name }) {
    return await getApp().connectToMachine(Name);
  },
  "/machine/remove": async function ({ Name, force }) {
    return await getApp().removeMachine(Name, force);
  },
  "/machine/create": async function (opts) {
    return await getApp().createMachine(opts);
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
