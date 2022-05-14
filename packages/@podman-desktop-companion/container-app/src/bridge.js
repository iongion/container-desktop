// project
const { findProgram } = require("@podman-desktop-companion/detector");
const { createLogger } = require("@podman-desktop-companion/logger");
const { launchTerminal } = require("@podman-desktop-companion/terminal");
const { Podman, Docker } = require("@podman-desktop-companion/container-client").adapters;
// locals
const { getDefaultDescriptor } = require("./bridge/descriptor");
const machine = require("./bridge/machine");
const proxy = require("./bridge/proxy");
const security = require("./bridge/security");
const settings = require("./bridge/settings");
const system = require("./bridge/system");
const test = require("./bridge/test");
const window = require("./bridge/window");

const adaptersList = [Podman.Adapter, Docker.Adapter];

const createBridge = (bridgeOpts) => {
  const { ipcRenderer, userConfiguration, osType, version, environment } = bridgeOpts;
  const defaultConnectorId = osType === "Linux" ? "engine.default.podman.native" : "engine.default.podman.virtualized";
  const logger = createLogger("bridge");
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
  const actionContext = {
    getCurrentApi: () => currentApi,
    getAdapters: () => adapters,
    getEngines: () => engines,
    getConnector: () => connectors,
    userConfiguration,
    osType,
    version,
    environment,
    defaultConnectorId
  };
  const actionOptions = bridgeOpts;
  const machineActions = machine.createActions(actionContext, actionOptions);
  const proxyActions = proxy.createActions(actionContext, actionOptions);
  const securityActions = security.createActions(actionContext, actionOptions);
  const settingsActions = settings.createActions(actionContext, actionOptions);
  const systemActions = system.createActions(actionContext, actionOptions);
  const testActions = test.createActions(actionContext, actionOptions);
  const windowActions = window.createActions(actionContext, actionOptions);
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
    // plugins
    ...machineActions,
    ...proxyActions,
    ...securityActions,
    ...settingsActions,
    ...systemActions,
    ...testActions,
    ...windowActions,
    // extras
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
        userSettings: settingsActions.getGlobalUserSettings()
      };
      return descriptor;
    },
    setup() {
      logger.error("Application setup");
      return { logger: createLogger("shell.ui") };
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
    // FIND
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
