const { setLevel, getLevel, createLogger } = require("@podman-desktop-companion/logger");
const { createWorkerGateway } = require("@podman-desktop-companion/rpc");
// locals
const { createApiDriver } = require("./api");
const { Application } = require("./application");
const { Podman, Docker } = require("./adapters");
const adaptersList = [Podman.Adapter, Docker.Adapter];

const createBridge = ({ ipcRenderer, userConfiguration, osType, version, environment }) => {
  const logger = createLogger("bridge");
  const bridge = {
    async start(opts) {
      logger.debug("*** starting", opts);
      let descriptor = await Application.getDefaultDescriptor({ userConfiguration, osType, version, environment });
      try {
        const adapters = adaptersList.map((Adapter) => Adapter.create(userConfiguration, osType));
        const engines = adapters.reduce((acc, adapter) => {
          const adapterEngines = adapter.createEngines();
          acc.push(...adapterEngines);
          return acc;
        }, []);
        const connectors = [];
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
        let currentConnector;
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
          currentConnector = connectors.find(({ id }) => {
            if (osType === "Windows_NT" || osType === "Darwin") {
              return id === "engine.default.podman.virtualized";
            }
            return id === "engine.default.podman.native";
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
          const currentEngine = engines.find((it) => it.id === currentConnector.id);
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
    minimize() {
      logger.debug("Application minimize");
      try {
        ipcRenderer.send("window.minimize");
      } catch (error) {
        logger.error("Unable to minimize", error);
      }
    },
    maximize() {
      logger.debug("Application maximize");
      try {
        ipcRenderer.send("window.maximize");
      } catch (error) {
        logger.error("Unable to maximize", error);
      }
    },
    restore() {
      logger.debug("Application restore");
      try {
        ipcRenderer.send("window.restore");
      } catch (error) {
        logger.error("Unable to restore", error);
      }
    },
    close() {
      logger.debug("Application close");
      try {
        ipcRenderer.send("window.close");
      } catch (error) {
        logger.error("Unable to close", error);
      }
    },
    exit() {
      logger.debug("Application exit");
      try {
        ipcRenderer.send("application.exit");
      } catch (error) {
        logger.error("Unable to exit", error);
      }
    },
    relaunch() {
      logger.debug("Application relaunch");
      try {
        ipcRenderer.send("application.relaunch");
      } catch (error) {
        logger.error("Unable to relaunch", error);
      }
    },
    openDevTools() {
      logger.debug("Application openDevTools");
      try {
        ipcRenderer.send("openDevTools");
      } catch (error) {
        logger.error("Unable to openDevTools", error);
      }
    },
    async openFileSelector(options) {
      logger.debug("Application openFileSelector", options);
      try {
        const result = await ipcRenderer.invoke("openFileSelector", options);
        return result;
      } catch (error) {
        logger.error("Unable to openFileSelector", error);
      }
    },
    async openTerminal(options) {
      logger.debug("Application openTerminal", options);
      try {
        const result = await ipcRenderer.invoke("openTerminal", options);
        return result;
      } catch (error) {
        logger.error("Unable to openTerminal", error);
      }
    },
    async proxy(req, ctx, opts) {
      const gateway = createWorkerGateway(() => new Worker("worker.js"));
      // Inject configuration
      ctx.configuration = {
        osType: osType,
        version: version,
        environment: environment
      };
      return await gateway.invoke(req, ctx, opts);
    },
    async proxyHTTPRequest(req) {
      const driver = createApiDriver({
        baseURL: req.baseURL,
        socketPath: req.socketPath
      });
      let result;
      try {
        const response = await driver.request({
          method: req.method,
          url: req.url,
          params: req.params,
          data: req.data
        });
        result = {
          ok: response.status >= 200 && response.status <= 300,
          status: response.status,
          statusText: response.statusText,
          data: response.data,
          headers: response.headers
        };
      } catch (error) {
        if (error.response) {
          logger.error("Response error", error.message, error.stack);
          result = {
            ok: false,
            status: error.response.status,
            statusText: error.response.statusText,
            data: error.response.data,
            headers: error.response.headers
          };
        } else {
          logger.error("Request exception", error.message, error.stack);
          result = {
            ok: false,
            status: 500,
            statusText: "Request exception",
            data: undefined,
            headers: {}
          };
        }
      }
      return {
        result: result,
        success: result.ok,
        warnings: []
      };
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
      descriptor: Application.getDefaultDescriptor({
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
