// vendors
const os = require("os");
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

async function getUserConfiguration() {
  const osType = os.type();
  const connectionString = await application.findApiConnectionString();
  const options = {
    engine: await application.findEngine(),
    program: await application.findProgram(),
    startApi: userSettings.get("startApi", false),
    minimizeToSystemTray: userSettings.get("minimizeToSystemTray", false),
    communication: "api",
    path: userSettings.getPath(),
    logging: {
      level: getLevel()
    },
    connectionString: osType === "Windows_NT" ? connectionString : `unix://${connectionString}`
  };
  return options;
}

async function setUserConfiguration(options) {
  logger.debug("Updating user configuration", options);
  Object.keys(options).forEach(async (key) => {
    if (key === "logging.level") {
      setLevel(options[key]);
    } else if (key === "engine") {
      await application.setEngine(options[key]);
    } else {
      userSettings.set(key, options[key]);
    }
  });
  return await getUserConfiguration();
}

const servicesMap = {
  "/start": async function () {
    return await getApp().getDescriptor();
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
  "/user/configuration/get": async function () {
    return await getUserConfiguration();
  },
  "/user/configuration/set": async function ({ options }) {
    await setUserConfiguration(options);
    return await getUserConfiguration();
  },
  "/system/running": async function () {
    return await application.getIsApiRunning();
  },
  "/system/connections": async function () {
    const client = await application.getClient();
    return client.getSystemConnections();
  },
  "/system/info": async function () {
    const client = await application.getClient();
    return client.getSystemInfo();
  },
  "/system/prune": async function () {
    const client = await application.getClient();
    return client.pruneSystem();
  },
  "/system/api/start": async function () {
    return await application.startApi();
  },
  "/system/reset": async function () {
    const client = await application.getClient();
    return client.resetSystem();
  },
  "/container/connect": async function ({ Id }) {
    const client = await application.getClient();
    return client.connectToContainer(Id);
  },
  "/machines/list": async function () {
    const client = await application.getClient();
    return client.getMachines();
  },
  "/machine/restart": async function ({ Name }) {
    const client = await application.getClient();
    return client.restartMachine(Name);
  },
  "/machine/stop": async function ({ Name }) {
    const client = await application.getClient();
    return client.stopMachine(Name);
  },
  "/machine/connect": async function ({ Name }) {
    const client = await application.getClient();
    return client.connectToMachine(Name);
  },
  "/machine/remove": async function ({ Name, force }) {
    const client = await application.getClient();
    return client.removeMachine(Name, force);
  },
  "/machine/create": async function (opts) {
    const client = await application.getClient();
    return client.createMachine(opts);
  },
  "/test": async function (opts) {
    const result = await getApp().testApiReachability(opts.payload);
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
