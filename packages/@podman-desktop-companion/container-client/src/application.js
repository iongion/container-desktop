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
const { findProgram } = require("./detector");
// locals

class Application {
  constructor(version, env) {
    this.logger = createLogger("container-client.Application");
    this.configuration = new UserConfiguration(version, env);
    this.adaptersList = [Podman.Adapter, Docker.Adapter];
    // available only after start - hydrated in this order
    this.adapters = [];
    this.engines = [];
    this.currentEngine = undefined;
    this.connectors = [];
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
      platform: os.type(),
      provisioned,
      running,
      connectors: this.connectors,
      currentConnector,
      userPreferences: await this.getUserPreferences()
    };
  }

  // start
  async start(opts) {
    this.adapters = await this.getAdapters();
    this.engines = await this.getEngines();
    this.connectors = await this.getConnectors(this.engines);
    const { startApi, adapter, connector } = merge(
      {
        // defaults
        startApi: true,
        adapter: Podman.Adapter.ADAPTER,
        connector: this.configuration.getKey("connector.default")
      },
      opts || {}
    );
    // current connector
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
      this.logger.error("Unable to connect without any usable connector");
      return false;
    }
    // current engine
    this.currentEngine = this.engines.find((it) => it.id === this.currentConnector.id);
    if (!this.currentEngine) {
      this.logger.error("Unable to start without any usable engine");
      return false;
    }
    // this.configuration.setKey("connector.current", this.currentConnector.id);
    // Start API only if specified
    let started = false;
    if (startApi) {
      started = await this.currentEngine.startApi();
      this.currentConnector = await this.currentEngine.getConnector();
    }
    const descriptor = await this.getDescriptor();
    return descriptor;
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

  async setUserPreferences(opts) {
    Object.keys(opts).forEach((key) => {
      const value = opts[key];
      this.configuration.setKey(key, value);
      if (key === "logging") {
        setLevel(value.level);
      }
    });
    return await this.getUserPreferences();
  }

  async getUserPreferences() {
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

  // services
  async getSystemInfo() {
    return await this.currentEngine.getSystemInfo();
  }

  // testing

  async test(subject, payload) {
    let result = { success: false };
    switch (subject) {
      case "reachability.api":
        result = this.testApiReachability(payload);
        break;
      case "reachability.program":
        result = this.testProgramReachability(payload);
        break;
      default:
        result.details = `Unable to perform unknown test subject "${subject}"`;
        break;
    }
    return result;
  }

  async testProgramReachability(opts) {
    const result = { success: false };
    this.logger.debug("Testing if program is reachable", opts);
    if (opts.path) {
      try {
        const program = await findProgram(opts.path);
        this.logger.debug("Testing if program is reachable - completed", program);
        if (program.path) {
          result.success = true;
          result.details = "Program found";
          result.program = program;
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
