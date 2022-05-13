// project
const { getApiConfig } = require("@podman-desktop-companion/container-client/src/api");
const { findProgram, findProgramVersion, parseProgramVersion } = require("@podman-desktop-companion/detector");
const { setLevel, getLevel, createLogger } = require("@podman-desktop-companion/logger");
const { launchTerminal } = require("@podman-desktop-companion/terminal");
const { Podman, Docker } = require("@podman-desktop-companion/container-client").adapters;
// locals
const { getDefaultDescriptor } = require("./bridge/descriptor");
const { createMachineActions } = require("./bridge/machine");
const proxyActions = require("./bridge/proxy");
const { createWindowActions } = require("./bridge/window");
const adaptersList = [Podman.Adapter, Docker.Adapter];

const createBridge = ({ ipcRenderer, userConfiguration, osType, version, environment }) => {
  let adapters = [];
  let engines = [];
  let connectors = [];
  let currentConnector;
  let currentEngine;
  const windowActions = createWindowActions(ipcRenderer);
  const machineActions = createMachineActions({ getCurrentEngine: () => currentEngine });
  const logger = createLogger("bridge");
  const bridge = {
    ...windowActions,
    ...machineActions,
    ...proxyActions,
    async start(opts) {
      logger.debug("*** starting", opts);
      let descriptor = getDefaultDescriptor({ userConfiguration, osType, version, environment });
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
              logger.error("Unable to get engine connector", engine.ENGINE, error.message, error.stack);
            }
          })
        );
        // decide current connector
        // if from start function argument
        let userConnector = opts?.id;
        // if from saved preferences
        if (!userConnector) {
          userConnector = userConfiguration.getKey("connector.default");
        }
        if (userConnector) {
          currentConnector = connectors.find((it) => it.id === userConnector);
        }
        // if none found - default
        if (!currentConnector) {
          logger.debug("No default user connector - picking preferred(favor podman)");
          const defaultConnectorId =
            osType === "Linux" ? "engine.default.podman.native" : "engine.default.podman.virtualized";
          currentConnector = connectors.find(({ id }) => {
            return id === defaultConnectorId;
          });
        }
        if (!currentConnector) {
          logger.warn("Defaulting to first connector");
          currentConnector = connectors[0];
        }
        const startApi = !!opts?.startApi || userConfiguration.getKey("startApi", false);
        let provisioned = false;
        let running = false;
        if (currentConnector) {
          if (opts?.settings) {
            logger.debug("Using custom connector settings", startApi, opts.settings);
            currentConnector.settings.current = opts.settings;
          }
          currentEngine = engines.find((it) => it.id === currentConnector.id);
          if (currentEngine) {
            if (startApi) {
              let started = false;
              try {
                started = await currentEngine.startApi();
              } catch (error) {
                logger.error("Unable to start the api", error.message, error.stack);
              }
              if (started) {
                currentConnector.availability.api = true;
              }
            }
          }
          if (typeof currentConnector.availability.controller !== "undefined") {
            provisioned = currentConnector.availability.controller;
          } else {
            provisioned = currentConnector.availability.program;
          }
          running = currentConnector.availability.api;
        }
        descriptor = {
          environment,
          version,
          platform: osType,
          provisioned,
          running,
          connectors,
          currentConnector
        };
      } catch (error) {
        logger.error("Startup error", error);
      } finally {
        descriptor.userSettings = await bridge.getGlobalUserSettings();
      }
      return descriptor;
    },
    setup() {
      logger.error("Application setup");
      return { logger: createLogger("shell.ui") };
    },
    async setGlobalUserSettings(opts) {
      Object.keys(opts).forEach((key) => {
        const value = opts[key];
        userConfiguration.setKey(key, value);
        if (key === "logging") {
          setLevel(value.level);
        }
      });
      return await bridge.getGlobalUserSettings();
    },
    async getGlobalUserSettings() {
      return {
        startApi: userConfiguration.getKey("startApi", false),
        minimizeToSystemTray: userConfiguration.getKey("minimizeToSystemTray", false),
        path: userConfiguration.getStoragePath(),
        logging: {
          level: getLevel()
        },
        connector: {
          default: userConfiguration.getKey("connector.default")
        }
      };
    },
    // configuration
    async setEngineUserSettings(id, settings) {
      await userConfiguration.setKey(id, settings);
      return userConfiguration.getKey(id);
    },
    async getEngineUserSettings(id) {
      return await userConfiguration.getKey(id);
    },
    // extras
    async getPodLogs(id, tail) {
      const { program } = await currentEngine.getCurrentSettings();
      const args = ["pod", "logs"];
      if (typeof tail !== "undefined") {
        args.push(`--tail=${tail}`);
      }
      args.push("-f", id);
      const result = await currentEngine.runScopedCommand(program.path, args);
      return result;
    },
    async generateKube(entityId) {
      const capable = currentEngine.ADAPTER === Podman.Adapter.ADAPTER;
      if (!capable) {
        logger.error("Current engine is not able to generate kube yaml", currentEngine.ADAPTER, Podman.Adapter.ADAPTER);
        return null;
      }
      const { program } = await currentEngine.getCurrentSettings();
      const result = await currentEngine.runScopedCommand(program.path, ["generate", "kube", entityId]);
      if (!result.success) {
        logger.error("Unable to generate kube", entityId, result);
      }
      return result;
    },
    async getControllerScopes() {
      if (!currentEngine) {
        logger.error("No current engine");
        return [];
      }
      logger.debug("Listing controller scopes of current engine", currentEngine);
      return await currentEngine.getControllerScopes();
    },

    async connectToContainer(opts) {
      const { id, title, shell } = opts || {};
      logger.debug("Connecting to container", opts);
      const { program } = await currentEngine.getCurrentSettings();
      const { launcher, command } = await currentEngine.getScopedCommand(program.path, [
        "exec",
        "-it",
        id,
        shell || "/bin/sh"
      ]);
      logger.debug("Launching terminal for", { launcher, command });
      const output = await launchTerminal(launcher, command, {
        title: title || `${currentEngine.ADAPTER} container`
      });
      if (!output.success) {
        logger.error("Unable to connect to container", id, output);
      }
      return output.success;
    },
    async getSystemInfo() {
      return await currentEngine.getSystemInfo();
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
          const version = await findProgramVersion(controller.path, { osType: osType });
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
      return await currentEngine.pruneSystem();
    },
    async resetSystem() {
      return await currentEngine.resetSystem();
    },
    // proxying
    async createApiRequest(opts, driverOpts) {
      // Normalize response
      let result = {
        ok: false,
        data: undefined,
        headers: [],
        status: 500,
        statusText: "API request error"
      };
      try {
        if (!currentEngine) {
          logger.error("Cannot create api request - no valid client for current engine");
          throw new Error("No valid client for current engine");
        }
        const driver = await currentEngine.getApiDriver(driverOpts);
        const response = await driver.request(opts);
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
    }
  };
  return bridge;
};

function createContext(opts) {
  return {
    available: true,
    platform: opts.osType,
    defaults: {
      connector: opts.userConfiguration.getKey("connector.default"),
      // This must not fail - prevents startup failures to put the app in an undefined state
      descriptor: getDefaultDescriptor({
        osType: opts.osType,
        version: opts.version,
        environment: opts.environment
      })
    },
    application: createBridge(opts)
  };
}

module.exports = {
  createContext,
  createBridge
};
