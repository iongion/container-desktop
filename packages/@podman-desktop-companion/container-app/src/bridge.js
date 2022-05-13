// project
const { getApiConfig } = require("@podman-desktop-companion/container-client/src/api");
const {
  findProgram,
  findProgramVersion,
  parseProgramVersion,
  getAvailablePodmanMachines
} = require("@podman-desktop-companion/detector");
const { setLevel, getLevel, createLogger } = require("@podman-desktop-companion/logger");
const { launchTerminal } = require("@podman-desktop-companion/terminal");
const { Podman, Docker } = require("@podman-desktop-companion/container-client").adapters;
// locals
const { getDefaultDescriptor } = require("./bridge/descriptor");
const { createMachineActions } = require("./bridge/machine");
const { createWindowActions } = require("./bridge/window");
const adaptersList = [Podman.Adapter, Docker.Adapter];

const createBridge = ({ ipcRenderer, userConfiguration, osType, version, environment }) => {
  const logger = createLogger("bridge");
  const defaultConnectorId = osType === "Linux" ? "engine.default.podman.native" : "engine.default.podman.virtualized";
  let adapters = [];
  let engines = [];
  let connectors = [];
  let inited = false;
  let currentApi = {
    provisioned: false,
    running: false,
    started: false,
    connector: undefined,
    engine: undefined,
    destroy: async () => {
      logger.debug("API not started");
      return false;
    }
  };
  let descriptor = getDefaultDescriptor({
    osType,
    version,
    environment
  });
  const windowActions = createWindowActions(ipcRenderer);
  const machineActions = createMachineActions({ getCurrentEngine: () => currentApi?.engine });
  const init = async () => {
    if (inited) {
      logger.debug("Init skipping - already initialized");
      return inited;
    }
    try {
      adapters = adaptersList.map((Adapter) => Adapter.create(userConfiguration, osType));
      engines = adapters.reduce((acc, adapter) => {
        const adapterEngines = adapter.createEngines();
        acc.push(...adapterEngines);
        return acc;
      }, []);
      await Promise.all(
        engines.map(async (engine) => {
          try {
            const connector = await engine.getConnector();
            connectors.push(connector);
          } catch (error) {
            logger.error("Init - Unable to get engine connector", engine.ENGINE, error.message, error.stack);
          }
        })
      );
    } catch (error) {
      logger.error("Init - Unable to initialize", error.message, error.stack);
    }
    inited = true;
    return inited;
  };
  const getCurrentConnector = (opts) => {
    // decide current connector
    let connector;
    // if from start function argument
    let userConnectorId = opts?.id;
    // if from saved preferences
    if (!userConnectorId) {
      userConnectorId = userConfiguration.getKey("connector.default");
    }
    if (userConnectorId) {
      connector = connectors.find((it) => it.id === userConnectorId);
    }
    // if none found - default
    if (!connector) {
      logger.debug("No default user connector - picking preferred(favor podman)");
      connector = connectors.find(({ id }) => id === defaultConnectorId);
    }
    if (!connector) {
      logger.warn("Defaulting to first connector");
      connector = connectors[0];
    }
    if (opts?.settings) {
      logger.debug("Using custom connector settings", opts.settings);
      connector.settings.current = opts.settings;
    }
    return connector;
  };
  const createConnectorEngineApi = async (connector, opts) => {
    logger.debug("Creating connector engine api", connector?.id);
    const startApi = !!opts?.startApi || userConfiguration.getKey("startApi", false);
    let provisioned = false;
    let running = false;
    let started = false;
    let engine;
    if (connector) {
      try {
        engine = engines.find((it) => it.id === connector.id);
        if (engine) {
          if (opts?.settings) {
            logger.debug("Using custom current engine settings", opts.settings);
            await engine.setCurrentSettings(connector.settings.current);
          }
          if (startApi) {
            try {
              logger.debug(connector.id, "Creating connector engine api start - trigger");
              started = await engine.startApi();
            } catch (error) {
              logger.error(connector.id, "Creating connector engine api start - failed", error.message, error.stack);
            }
            if (started) {
              connector.availability.api = true;
            }
          }
        }
        if (typeof connector.availability.controller !== "undefined") {
          provisioned = connector.availability.controller;
        } else {
          provisioned = connector.availability.program;
        }
        running = connector.availability.api;
      } catch (error) {
        logger.error("Connector engine api creation error", error.message, error.stack);
      }
    }
    const host = {
      provisioned,
      running,
      started,
      connector,
      engine,
      destroy: async () => {
        if (host.started) {
          if (engine) {
            try {
              logger.debug(host.connector?.id, "Stopping existing API");
              await engine.stopApi();
              connector.availability.api = false;
              host.running = false;
              host.started = false;
            } catch (error) {
              logger.error(host.connector?.id, "Stopping existing API failed", error.message, error.stack);
            }
          } else {
            logger.warn("Stopping existing API- skipped(not engine)");
          }
        } else {
          logger.debug("Stopping existing API- skipped(not started)");
        }
        return true;
      }
    };
    return host;
  };
  const bridge = {
    async start(opts) {
      logger.debug("Bridge startup - begin", opts);
      try {
        await init();
        if (currentApi) {
          await currentApi.destroy();
        }
        logger.debug("Bridge startup - creating current");
        currentApi = await createConnectorEngineApi(getCurrentConnector(opts), opts);
      } catch (error) {
        logger.error("Bridge startup error", error);
      }
      logger.debug("Bridge startup - creating descriptor", opts);
      descriptor = {
        environment,
        version,
        osType,
        provisioned: !!currentApi?.provisioned,
        running: !!currentApi?.running,
        connectors,
        currentConnector: currentApi?.connector,
        userSettings: bridge.getGlobalUserSettings()
      };
      return descriptor;
    },
    setup() {
      logger.error("Application setup");
      return { logger: createLogger("shell.ui") };
    },
    setGlobalUserSettings(opts) {
      Object.keys(opts).forEach((key) => {
        const value = opts[key];
        userConfiguration.setKey(key, value);
        if (key === "logging") {
          setLevel(value.level);
        }
      });
      return bridge.getGlobalUserSettings();
    },
    getGlobalUserSettings() {
      return {
        startApi: userConfiguration.getKey("startApi", false),
        minimizeToSystemTray: userConfiguration.getKey("minimizeToSystemTray", false),
        path: userConfiguration.getStoragePath(),
        logging: {
          level: getLevel()
        },
        connector: {
          default: userConfiguration.getKey("connector.default", defaultConnectorId)
        }
      };
    },
    // configuration
    setEngineUserSettings(id, settings) {
      userConfiguration.setKey(id, settings);
      return userConfiguration.getKey(id);
    },
    getEngineUserSettings(id) {
      return userConfiguration.getKey(id);
    },
    // extras
    async getPodLogs(id, tail) {
      const { program } = await currentApi.engine.getCurrentSettings();
      const args = ["pod", "logs"];
      if (typeof tail !== "undefined") {
        args.push(`--tail=${tail}`);
      }
      args.push("-f", id);
      const result = await currentApi.engine.runScopedCommand(program.path, args);
      return result;
    },
    async generateKube(entityId) {
      const capable = currentApi.engine.ADAPTER === Podman.Adapter.ADAPTER;
      if (!capable) {
        logger.error(
          "Current engine is not able to generate kube yaml",
          currentApi.engine.ADAPTER,
          Podman.Adapter.ADAPTER
        );
        return null;
      }
      const { program } = await currentApi.engine.getCurrentSettings();
      const result = await currentApi.engine.runScopedCommand(program.path, ["generate", "kube", entityId]);
      if (!result.success) {
        logger.error("Unable to generate kube", entityId, result);
      }
      return result;
    },
    async getControllerScopes() {
      if (!currentApi.engine) {
        logger.error("No current engine");
        return [];
      }
      logger.debug("Listing controller scopes of current engine", currentApi.engine);
      return await currentApi.engine.getControllerScopes();
    },

    async connectToContainer(opts) {
      const { id, title, shell } = opts || {};
      logger.debug("Connecting to container", opts);
      const { program } = await currentApi.engine.getCurrentSettings();
      const { launcher, command } = await currentApi.engine.getScopedCommand(program.path, [
        "exec",
        "-it",
        id,
        shell || "/bin/sh"
      ]);
      logger.debug("Launching terminal for", { launcher, command });
      const output = await launchTerminal(launcher, command, {
        title: title || `${currentApi.engine.ADAPTER} container`
      });
      if (!output.success) {
        logger.error("Unable to connect to container", id, output);
      }
      return output.success;
    },
    async getSystemInfo() {
      return await currentApi.engine.getSystemInfo();
    },
    //// TEST
    async test({ subject, payload }) {
      let result = { success: false };
      switch (subject) {
        case "reachability.api":
          result = bridge.testApiReachability(payload);
          break;
        case "reachability.program":
          result = bridge.testProgramReachability(payload);
          break;
        default:
          result.details = `Unable to perform unknown test subject "${subject}"`;
          break;
      }
      return result;
    },
    async testProgramReachability(opts) {
      const result = { success: false, program: undefined };
      const { adapter, engine, controller, program } = opts;
      logger.debug(adapter, engine, "Testing if program is reachable", opts);
      const testController =
        controller?.path && [Podman.ENGINE_PODMAN_VIRTUALIZED, Docker.ENGINE_DOCKER_VIRTUALIZED].includes(engine);
      if (testController) {
        try {
          const version = await findProgramVersion(controller.path, { osType });
          if (!version) {
            logger.error(adapter, engine, "[C] Program test failed - no version", controller);
            throw new Error("Test failed - no version");
          }
          if (version) {
            let scopes = [];
            try {
              scopes = await getAvailablePodmanMachines(controller.path);
            } catch (error) {
              logger.error(adapter, engine, "[C] Unable to list podman machines", error.message, error.stack);
            }
            result.success = true;
            result.details = `Program has been found - version ${version}`;
            result.scopes = scopes;
            result.program = {
              path: controller.path,
              version
            };
          }
        } catch (error) {
          logger.error(adapter, engine, "[C] Testing if program is reachable - failed during detection", error.message);
          result.details = "Program detection error";
        }
      } else if (program.path) {
        try {
          // Always instantiate engines for tests
          const adapterInstance = adapters.find((it) => it.ADAPTER === adapter);
          const adapterEngine = adapterInstance.createEngineByName(engine);
          if (!adapterEngine) {
            result.success = false;
            result.details = "Adapter engine is not accessible";
          } else {
            const check = await adapterEngine.runScopedCommand(program.path, ["--version"], {
              scope: controller?.scope
            });
            logger.debug(adapter, engine, "[P] Testing if program is reachable - completed", check);
            const version = check.success ? parseProgramVersion(check.stdout) : undefined;
            if (check.success && version) {
              result.success = true;
              result.details = `Program has been found - version ${version}`;
              result.program = {
                path: program.path,
                version
              };
            }
          }
        } catch (error) {
          logger.error(adapter, engine, "[P] Testing if program is reachable - failed during detection", error.message);
          result.details = "Program detection error";
        }
      }
      return result;
    },
    async testApiReachability(opts) {
      const result = { success: false };
      const { adapter, engine } = opts;
      logger.debug("Testing if api is reachable", opts);
      // Always instantiate engines for tests
      const adapterInstance = adapters.find((it) => it.ADAPTER === adapter);
      const adapterEngine = adapterInstance.createEngineByName(engine);
      if (!adapterEngine) {
        result.success = false;
        result.details = "Adapter engine is not accessible";
      } else {
        const config = getApiConfig(opts.baseURL, opts.connectionString);
        const driver = await adapterEngine.getApiDriver(config);
        try {
          const response = await driver.request({ method: "GET", url: "/_ping" });
          result.success = response?.data === "OK";
          result.details = response?.data || "Api reached";
        } catch (error) {
          result.details = "API is not reachable - start manually or connect";
          logger.error(
            "Reachability test failed",
            opts,
            error.message,
            error.response ? { code: error.response.status, statusText: error.response.statusText } : ""
          );
        }
        logger.debug("[P] Testing if api is reachable - completed", result.success);
      }
      return result;
    },
    /// FIND
    async findProgram(opts) {
      const engine = engines.find((it) => it.id === opts.id);
      if (!engine) {
        logger.error("Unable to find a matching engine", opts.id);
        throw new Error("Find failed - no engine");
      }
      try {
        const locator = opts.engine === Podman.ENGINE_PODMAN_VIRTUALIZED ? "whereis" : "which";
        const result = await engine.getScopedCommand(locator, [opts.program], { scope: opts.scope });
        const wrapper = { launcher: result.launcher, args: result.command.slice(0, -2) };
        const detect = await findProgram(opts.program, { wrapper });
        return detect;
      } catch (error) {
        logger.error("Unable to find program", error.message);
      }
    },
    // System
    async pruneSystem() {
      return await currentApi.engine.pruneSystem();
    },
    async resetSystem() {
      return await currentApi.engine.resetSystem();
    },
    // proxying
    ...windowActions,
    ...machineActions,
    proxyHTTPRequest: async (proxyRequest) => {
      let result = {
        ok: false,
        data: undefined,
        headers: [],
        status: 500,
        statusText: "API request error"
      };
      const { request, baseURL, socketPath, engine, adapter, scope } = proxyRequest;
      try {
        const driver = await currentApi.engine.getApiDriver({
          baseURL,
          socketPath
        });
        const response = await driver.request(request);
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
      return {
        result: result,
        success: result.ok,
        warnings: []
      };
    }
  };
  return bridge;
};

function createContext(opts) {
  const descriptor = getDefaultDescriptor({
    osType: opts.osType,
    version: opts.version,
    environment: opts.environment
  });
  const bridge = createBridge(opts);
  descriptor.userSettings = bridge.getGlobalUserSettings();
  return {
    available: true,
    osType: opts.osType,
    defaults: {
      connector: opts.userConfiguration.getKey("connector.default"),
      // This must not fail - prevents startup failures to put the app in an undefined state
      descriptor
    },
    application: bridge
  };
}

module.exports = {
  createContext,
  createBridge
};
