// vendors
// project
const { getLevel, setLevel, createLogger } = require("@podman-desktop-companion/logger");
const userSettings = require("@podman-desktop-companion/user-settings");
const { Backend } = require("@podman-desktop-companion/container-client");
// locals
const logger = createLogger("shell.ipc");
const backend = new Backend();

async function getProgram() {
  const name = await backend.getProgramName();
  return {
    name,
    path: await backend.getProgramPath(),
    currentVersion: await backend.getProgramVersion(),
    title: name,
    homepage: `https://${name}.io`
  }
}

async function getUserConfiguration() {
  const options = {
    engine: await backend.getEngine(),
    program: await getProgram(),
    autoStartApi: userSettings.get("autoStartApi", false),
    minimizeToSystemTray: userSettings.get("minimizeToSystemTray", false),
    communication: "api",
    path: userSettings.getPath(),
    logging: {
      level: getLevel()
    }
  };
  return options;
}

async function setUserConfiguration(options) {
  Object.keys(options).forEach(async (key) => {
    if (key === "logging.level") {
      setLevel(options[key]);
    } else if (key === "engine") {
      await backend.setEngine(options[key]);
    } else {
      userSettings.set(key, options[key]);
    }
  });
  return await getUserConfiguration();
}

const servicesMap = {
  "/container/engine/request": async function (options) {
    let result = {
      data: undefined,
      headers: [],
      status: 500,
      statusText: "API request error"
    };
    try {
      const response = await backend.createApiRequest(options);
      result = {
        ok: response.status >= 200 && response.status < 300,
        data: response.data,
        headers: response.headers,
        status: response.status,
        statusText: response.statusText
      };
    } catch (error) {
      logger.error("API request error", error.message);
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
    return await backend.getIsApiRunning();
  },
  "/system/connections": async function () {
    return await backend.getSystemConnections();
  },
  "/system/info": async function () {
    return await backend.getSystemInfo();
  },
  "/system/prune": async function () {
    return await backend.pruneSystem();
  },
  "/system/environment": async function () {
    const program = await getProgram();
    const system = await backend.getSystemEnvironment();
    system.userConfiguration = await getUserConfiguration();
    const hasProgram = program.path && program.currentVersion;
    const isRunning = await backend.getIsApiRunning();
    system.provisioned = hasProgram && isRunning;
    return system;
  },
  "/system/api/start": async function () {
    return await backend.startApi();
  },
  "/system/reset": async function () {
    return await backend.resetSystem();
  },
  "/container/connect": async function ({ Id }) {
    return await backend.connectToContainer(Id);
  },
  "/machines/list": async function () {
    return await backend.getMachines();
  },
  "/machine/restart": async function ({ Name }) {
    return await backend.restartMachine(Name);
  },
  "/machine/stop": async function ({ Name }) {
    return await backend.stopMachine(Name);
  },
  "/machine/connect": async function ({ Name }) {
    return await backend.connectToMachine(Name);
  },
  "/machine/remove": async function ({ Name, force }) {
    return await backend.removeMachine(Name, force);
  },
  "/machine/create": async function (opts) {
    return await backend.createMachine(opts);
  }
};

module.exports = {
  invoker: {
    invoke: async (method, params) => {
      let result = {
        success: false,
        data: undefined,
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
