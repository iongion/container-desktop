// vendors
// project
const { createLogger } = require("@podman-desktop-companion/logger");
const {
  isApiRunning,
  resetSystem,
  startApi,
  getSystemEnvironment,
  getSystemInfo,
  pruneSystem,
  getMachines,
  createApiRequest,
  connectToContainer,
  createMachine,
  connectToMachine,
  restartMachine,
  stopMachine,
  removeMachine,
  getUserConfiguration,
  setUserConfiguration
} = require("@podman-desktop-companion/container-client");
// locals
const logger = createLogger("shell.ipc");

const servicesMap = {
  "/container/engine/request": async function (options) {
    let result = {
      data: undefined,
      headers: [],
      status: 500,
      statusText: "API request error"
    };
    try {
      const response = await createApiRequest(options);
      result = {
        data: response.data,
        headers: response.headers,
        status: response.status,
        statusText: response.statusText
      };
    } catch (error) {
      logger.error("API request error", error);
      result.statusText = `API request error: ${error.message}`;
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
    return await isApiRunning();
  },
  "/system/connections": async function () {
    return await getSystemConnections();
  },
  "/system/info": async function () {
    return await getSystemInfo();
  },
  "/system/prune": async function () {
    return await pruneSystem();
  },
  "/system/environment": async function () {
    return await getSystemEnvironment();
  },
  "/system/api/start": async function () {
    return await startApi();
  },
  "/system/reset": async function () {
    return await resetSystem();
  },
  "/container/connect": async function ({ Id }) {
    return await connectToContainer(Id);
  },
  "/machines/list": async function () {
    return await getMachines();
  },
  "/machine/restart": async function ({ Name }) {
    return await restartMachine(Name);
  },
  "/machine/stop": async function ({ Name }) {
    return await stopMachine(Name);
  },
  "/machine/connect": async function ({ Name }) {
    return await connectToMachine(Name);
  },
  "/machine/remove": async function ({ Name, force }) {
    return await removeMachine(Name, force);
  },
  "/machine/create": async function (opts) {
    return await createMachine(opts);
  }
};

module.exports = {
  invoker: {
    invoke: async (method, params) => {
      let result = {
        success: false,
        data: null,
        warnings: []
      };
      const service = servicesMap[method];
      // logger.debug("Creating invocation", method, params);
      if (service) {
        try {
          // logger.debug("Invoking", method, params);
          result.success = true;
          result.data = await service(params);
        } catch (error) {
          const response = {
            statusText: error.response?.statusText,
            status: error.response?.status,
            data: error.response?.data
          };
          logger.error("Invoking error", error.message, response, "when invoking", { method, params });
          result.success = false;
          result.data = error.message;
          result.stack = error.stack;
          result.response = response;
        }
      } else {
        logger.error("No such IPC method", { method, params });
        result.success = false;
        result.data = "No such IPC method";
      }
      return result;
    }
  }
};
