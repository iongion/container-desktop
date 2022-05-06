// node
const os = require("os");
// vendors
const merge = require("lodash.merge");
// project
const { setLevel, createLogger } = require("@podman-desktop-companion/logger");
// module
const { Podman, Docker } = require("./adapters");
const { UserConfiguration } = require("./configuration");
const { getApiConfig, createApiDriver } = require("./api");
// locals

class Application {
  constructor(version, env, osType) {
    this.logger = createLogger("container-client.Application");
    this.configuration = new UserConfiguration(version, env);
    this.adaptersList = [Podman.Adapter, Docker.Adapter];
    // available only after start - hydrated in this order
    this.adapters = [];
    this.currentAdapter = undefined;
    this.engines = [];
    this.currentEngine = undefined;
    this.connectors = [];
    this.currentConnector = undefined;
    this.started = false;
    this.osType = osType || os.type();
  }

  async getAdapters() {
    const items = this.adaptersList.map((Adapter) => {
      const adapter = new Adapter(this.configuration);
      return adapter;
    });
    return items;
  }

  async getEngines() {
    const items = [];
    await Promise.all(
      this.adapters.map(async (adapter) => {
        const adapterEngines = await adapter.createEngines();
        items.push(...adapterEngines);
      })
    );
    return items;
  }

  async getConnectors() {
    const items = [];
    await Promise.all(
      this.engines.map(async (engine) => {
        const connector = await engine.getConnector();
        items.push(connector);
      })
    );
    return items;
  }

  async getDescriptor() {
    let running = false;
    let provisioned = false;
    const currentConnector = this.currentConnector;
    if (currentConnector) {
      provisioned = currentConnector.availability.program;
      if (typeof currentConnector.availability.controller !== "undefined") {
        provisioned = currentConnector.availability.program && currentConnector.availability.controller;
      }
      running = currentConnector.availability.api;
    }
    return {
      environment: process.env.REACT_APP_ENV || "development",
      version: process.env.REACT_APP_PROJECT_VERSION || "1.0.0",
      platform: this.osType,
      provisioned,
      running,
      connectors: this.connectors,
      currentConnector,
      userSettings: await this.getGlobalUserSettings()
    };
  }

  // init
  async init(opts) {
    const { startApi, adapter, connector } = merge(
      {
        // defaults
        startApi: true,
        adapter: Podman.Adapter.ADAPTER,
        connector: this.configuration.getKey("connector.default")
      },
      opts || {}
    );
    this.adapters = await this.getAdapters();
    this.engines = await this.getEngines();
    this.connectors = await this.getConnectors(this.engines);
    // 1st source - user preferred
    if (connector) {
      this.currentConnector = this.connectors.find(({ id }) => {
        return id === connector;
      });
    }
    // 2st source - user preferred is missing - default
    if (!this.currentConnector) {
      this.logger.debug(connector ? "Specified connector not found - defaulting" : "Connector not found - defaulting");
      this.currentConnector = this.connectors.find(({ availability }) => {
        return availability.engine && availability.program;
      });
    }
    if (!this.currentConnector) {
      this.logger.error("Unable to init without any usable connector");
      return false;
    }
    // current adapter inferred from connector
    this.currentAdapter = this.adapters.find((it) => it.ADAPTER === this.currentConnector.adapter);
    // current engine
    this.currentEngine = this.engines.find((it) => it.id === this.currentConnector.id);
    if (!this.currentEngine) {
      this.logger.error("Unable to init without any usable engine");
      return false;
    }
    return true;
  }

  // start
  async start(opts) {
    const inited = await this.init(opts);
    if (!inited) {
      this.logger.error("Unable to start - init incomplete");
      return false;
    }
    const { startApi, adapter, connector } = merge(
      {
        // defaults
        startApi: true,
        adapter: Podman.Adapter.ADAPTER,
        connector: this.configuration.getKey("connector.default")
      },
      opts || {}
    );
    // Start API only if specified
    if (startApi) {
      try {
        this.started = await this.currentEngine.startApi();
        if (this.started) {
          this.logger.debug("Updating connector post successful start-up to get updated details");
          this.currentConnector = await this.currentEngine.getConnector();
          this.connectors = this.connectors.map((it) => {
            if (it.id === this.currentConnector.id) {
              return { ...it, ...this.currentConnector };
            }
            return it;
          });
        }
      } catch (error) {
        this.started = false;
        this.logger.error("Application start error", error);
      }
    }
    const descriptor = await this.getDescriptor();
    return descriptor;
  }

  async stop() {
    if (!this.started) {
      this.logger.debug("Stop skipped - not started");
    }
    const stopped = await this.currentEngine.stopApi();
    this.stared = !stopped;
    return stopped;
  }

  // proxying

  async createApiRequest(opts) {
    const { currentEngine } = this;
    if (!currentEngine) {
      this.logger.error("Cannot create api request - no valid client for current engine");
      throw new Error("No valid client for current engine");
    }
    const driver = await currentEngine.getApiDriver();
    return driver.request(opts);
  }

  // configuration

  async setGlobalUserSettings(opts) {
    Object.keys(opts).forEach((key) => {
      const value = opts[key];
      this.configuration.setKey(key, value);
      if (key === "logging") {
        setLevel(value.level);
      }
    });
    return await this.getGlobalUserSettings();
  }

  async getGlobalUserSettings() {
    return {
      startApi: this.configuration.getKey("startApi", false),
      minimizeToSystemTray: this.configuration.getKey("minimizeToSystemTray", false),
      path: this.configuration.getStoragePath(),
      logging: {
        level: this.configuration.getKey("logging.level", "debug")
      },
      connector: {
        default: this.configuration.getKey("connector.default")
      }
    };
  }

  async setEngineUserSettings({ id, settings }) {
    const engine = this.engines.find((it) => it.id === id);
    if (!engine) {
      this.logger.error("Unable to updated settings of missing engine instance", id);
      throw new Error("Update failed - no engine");
    }
    return await engine.setUserSettings(settings);
  }

  async getEngineUserSettings(id) {
    const engine = this.engines.find((it) => it.id === id);
    return await engine.getUserSettings();
  }

  async getSystemInfo() {
    return await this.currentEngine.getSystemInfo();
  }

  async getMachines() {
    return await this.currentAdapter.getMachines(this.currentEngine);
  }

  async getControllerScopes() {
    return await this.currentAdapter.getControllerScopes(this.currentEngine);
  }

  async test(subject, payload) {
    let result = { success: false };
    switch (subject) {
      case "reachability.api":
        result = this.testApiReachability(payload);
        break;
      case "reachability.program":
        result = this.testEngineProgramReachability(payload);
        break;
      default:
        result.details = `Unable to perform unknown test subject "${subject}"`;
        break;
    }
    return result;
  }

  async testEngineProgramReachability({ id, program }) {
    const result = { success: false };
    this.logger.debug("Testing if program is reachable in engine", { program, engine: id });
    if (program.path) {
      try {
        const engine = this.engines.find((it) => it.id === id);
        if (!engine) {
          this.logger.error("Unable to updated settings of missing engine instance", id);
          throw new Error("Update failed - no engine");
        }
        const check = await engine.runScopedCommand(program.path, ["--version"]);
        this.logger.debug("Testing if program is reachable - completed", check);
        if (check.success) {
          result.success = true;
          result.details = "Program has been found";
        }
      } catch (error) {
        this.logger.error("Testing if program is reachable - failed during detection", error.message);
        result.details = "Program detection error";
      }
    }
    return result;
  }

  async testApiReachability(opts) {
    const result = { success: false };
    const config = await getApiConfig(opts.baseURL, opts.connectionString);
    this.logger.debug("Testing if API is reachable", config);
    const driver = await createApiDriver(config);
    try {
      const response = await driver.get("/_ping");
      result.success = response?.data === "OK";
      result.details = response?.data || "Api reached";
    } catch (error) {
      result.details = `API is not accessible`;
      this.logger.error("Reachability test failed", opts, error.message);
    }
    return result;
  }
}

module.exports = {
  Application
};
