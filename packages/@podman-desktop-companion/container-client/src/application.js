// node
const os = require("os");
// vendors
// project
const { createLogger } = require("@podman-desktop-companion/logger");
// module
const { Podman, Docker } = require("./adapters");
const { UserConfiguration } = require("./configuration");
const { getApiConfig, createApiDriver } = require("./api");
// locals

class Application {
  constructor(version, env) {
    this.logger = createLogger("container-client.Application");
    this.configuration = new UserConfiguration(version, env);
    this.adaptersList = [Podman.Adapter, Docker.Adapter];
    this.adapters = [];
  }

  async getAdapters() {
    if (!this.adapters.length) {
      const items = this.adaptersList.map((Adapter) => {
        const adapter = new Adapter(this.configuration);
        return adapter;
      });
      this.adapters = items;
    }
    return this.adapters;
  }

  async getEngines() {
    const adapterInstances = await this.getAdapters();
    const items = [];
    await Promise.all(
      adapterInstances.map(async (adapter) => {
        const adapterEngines = await adapter.getEngines();
        items.push(...adapterEngines);
      })
    );
    return items;
  }

  async getConnections() {
    const adapterInstances = await this.getAdapters();
    const items = [];
    await Promise.all(
      adapterInstances.map(async (adapter) => {
        const connections = await adapter.getConnections();
        items.push(...connections);
      })
    );
    return items;
  }

  async getCurrentConnection() {
    const connections = await this.getConnections();
    let item;
    // First preferred
    const currentConnectorId = this.configuration.getKey("connector.current");
    if (currentConnectorId) {
      item = connections.find((it) => it.id === currentConnectorId);
    }
    // First available - even if API is not started
    if (!item) {
      item = connections.find(({ connector }) => {
        return connector.availability.engine && connector.availability.program;
      });
    }
    // First in list
    if (!item) {
      item = connections[0];
    }
    return item;
  }

  async getUserPreferences() {
    return {
      clientId: this.configuration.getKey("connector.current"),
      startApi: this.configuration.getKey("startApi", false),
      minimizeToSystemTray: this.configuration.getKey("minimizeToSystemTray", false),
      path: this.configuration.getStoragePath(),
      logging: {
        level: this.configuration.getKey("logging.level", "debug")
      }
    };
  }

  async getDescriptor() {
    const connections = await this.getConnections();
    const current = await this.getCurrentConnection();
    let running = false;
    let provisioned = false;
    let currentConnector;
    if (current) {
      const { id, engine, connector } = current;
      provisioned = connector.availability.program;
      if (typeof connector.availability.controller !== "undefined") {
        provisioned = connector.availability.program && connector.availability.controller;
      }
      running = connector.availability.api;
      currentConnector = connector;
    }
    return {
      environment: process.env.REACT_APP_ENV || "development",
      version: process.env.REACT_APP_PROJECT_VERSION || "1.0.0",
      platform: os.type(),
      provisioned,
      running,
      connectors: connections.map((c) => c.connector),
      currentConnector,
      userPreferences: await this.getUserPreferences()
    };
  }

  async createApiRequest(opts) {
    const { client } = this;
    if (!client) {
      logger.error("Cannot create api request - no valid client for current engine");
      throw new Error("No valid client for current engine");
    }
    const driver = await client.getApiDriver();
    return driver.request(opts);
  }

  async testApiReachability(opts) {
    console.debug(opts);
    const config = await getApiConfig(opts.baseURL, opts.connectionString);
    const driver = await createApiDriver(config);
    const result = { success: false };
    try {
      const response = await driver.get("/_ping");
      result.success = response?.data === "OK";
      result.details = response?.data || "Api reached";
    } catch (error) {
      result.details = `API is not accessible - ${error.message}`;
    }
    return result;
  }
}

module.exports = {
  Application
};
