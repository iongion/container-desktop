// node
const os = require("os");
// vendors
// project
const { createLogger } = require("@podman-desktop-companion/logger");
const Clients = require("./clients");
const { Registry } = require("./registry");
const { UserConfiguration } = require("./configuration");
// module
// locals

class Application {
  constructor(version, env) {
    this.logger = createLogger("client.Application");
    this.configuration = new UserConfiguration(version, env);
    this.registry = new Registry(this.configuration, [
      Clients.Podman.Native,
      Clients.Podman.Virtualized,
      Clients.Podman.WSL,
      Clients.Podman.LIMA,
      Clients.Docker.Native,
      Clients.Docker.Virtualized,
      Clients.Docker.WSL,
      Clients.Docker.LIMA
    ]);
    this.connectors = undefined;
    this.client = undefined;
    this.inited = false;
    this.preferredEngines = {
      native: [Clients.Podman.Native.ENGINE, Clients.Docker.Native.ENGINE],
      virtualized: [Clients.Podman.Virtualized.ENGINE, Clients.Docker.Virtualized.ENGINE]
    };
  }

  async start() {
    const engine = await this.getCurrentConnector();
    const client = await this.getCurrentClient();
    if (!client) {
      this.logger.error("Unable to find a client for current engine", engine);
      throw new Error("No client for current engine");
    }
    const started = await client.startApi();
    return started;
  }
  async stop() {}

  async setConnectors(connectors) {
    this.connectors = connectors;
  }

  async getConnectors() {
    if (typeof this.connectors === "undefined") {
      this.connectors = await this.registry.getConnectors();
    }
    return this.connectors;
  }

  async isCurrentConnectorProvisioned() {
    let flag = false;
    const current = await this.getCurrentConnector();
    if (!current) {
      return flag;
    }
    const hasController = !!current.settings.current.controller;
    const programIsSet = !!current.settings.current.program.path;
    if (hasController) {
      const controllerIsSet = !!current.settings.current.controller.path;
      if (!controllerIsSet) {
        this.logger.warn("Current engine client controller is not configured", current);
      }
      flag = controllerIsSet && programIsSet;
    } else {
      flag = programIsSet;
    }
    return flag;
  }

  async getCurrentConnector() {
    const userEngineId = this.configuration.getKey("engine.current");
    const connectors = await this.getConnectors();
    let current;
    if (userEngineId) {
      current = connectors.find((it) => it.engine === current);
    }
    if (!current) {
      this.logger.debug("No user preferred engine - looking for native");
      current = connectors.find((it) => it.availability.available && this.preferredEngines.native.includes(it.engine));
    }
    if (!current) {
      this.logger.debug("No native supported engine - looking for virtualized");
      if (os.type() === "Windows_NT" || os.type() === "Darwin") {
        current = connectors.find(
          (it) => it.availability.available && this.preferredEngines.virtualized.includes(it.engine)
        );
      }
    }
    if (!current) {
      this.logger.debug("No virtualized supported engine - looking for available");
      current = connectors.find((it) => it.availability.available);
    }
    if (!current) {
      this.logger.error("No engine is supported on this machine - requirements might be incomplete");
    }
    return current;
  }

  async getCurrentClient() {
    const engine = await this.getCurrentConnector();
    let client;
    if (engine) {
      client = await this.registry.getConnectorClientById(engine.id);
      if (!client) {
        this.logger.error("Unable to find a client for engine", engine);
      }
    } else {
      this.logger.error("No current engine in this context");
    }
    return client;
  }
}

module.exports = {
  Application
};
