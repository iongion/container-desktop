// vendors
// project
const { createLogger } = require("@podman-desktop-companion/logger");
const {
  isApiRunning,
  resetSystem,
  startApi,
  getSystemEnvironment,
  getSystemInfo,
  getMachines,
  connectToContainer,
  createMachine,
  connectToMachine,
  restartMachine,
  stopMachine,
  removeMachine,
  getUserConfiguration,
  setUserConfiguration,
  getWSLDistributions
} = require("@podman-desktop-companion/container-client");
// locals
const logger = createLogger(__filename);

const servicesMap = {
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
  },
  "/wsl.distributions": async function (opts) {
    return await getWSLDistributions(opts);
  }
};

module.exports = {
  invoker: {
    invoke: async (method, params) => {
      let result = {
        success: false,
        body: null,
        warnings: []
      };
      const service = servicesMap[method];
      // logger.debug("Creating invocation", method, params);
      if (service) {
        try {
          // logger.debug("Invoking", method, params);
          result.success = true;
          result.body = await service(params);
        } catch (error) {
          logger.error("Invoking error", error.message, error.response, error);
          result.success = false;
          result.body = error.message;
          result.stack = error.stack;
          result.response = error.response;
        }
      } else {
        logger.error("No such IPC method", { method, params });
        result.success = false;
        result.body = "No such IPC method";
      }
      return result;
    }
  }
};
