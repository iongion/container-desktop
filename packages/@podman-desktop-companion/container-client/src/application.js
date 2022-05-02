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
    this.engines = undefined;
    this.client = undefined;
    this.inited = false;
    this.preferredEngines = {
      native: [Clients.Podman.Native.ENGINE, Clients.Docker.Native.ENGINE],
      virtualized: [Clients.Podman.Virtualized.ENGINE, Clients.Docker.Virtualized.ENGINE]
    };
  }

  async start() {
    const engine = await this.getCurrentEngine();
    const client = await this.getCurrentClient();
    if (!client) {
      this.logger.error("Unable to find a client for current engine", engine);
      throw new Error("No client for current engine");
    }
    const started = await client.startApi();
    return started;
  }
  async stop() {}

  async setEngines(engines) {
    this.engines = engines;
  }

  async getEngines() {
    if (typeof this.engines === "undefined") {
      this.engines = await this.registry.getEngines();
    }
    return this.engines;
  }

  async isCurrentEngineProvisioned() {
    let flag = false;
    const currentEngine = await this.getCurrentEngine();
    if (!currentEngine) {
      return flag;
    }
    const hasController = !!currentEngine.settings.current.controller;
    const programIsSet = !!currentEngine.settings.current.program.path;
    if (hasController) {
      const controllerIsSet = !!currentEngine.settings.current.controller.path;
      if (!controllerIsSet) {
        this.logger.warn("Current engine client controller is not configured", currentEngine);
      }
      flag = controllerIsSet && programIsSet;
    } else {
      flag = programIsSet;
    }
    return flag;
  }

  async getCurrentEngine() {
    const userEngineId = this.configuration.getKey("engine.current");
    const engines = await this.getEngines();
    let currentEngine;
    if (userEngineId) {
      currentEngine = engines.find((it) => it.engine === currentEngine);
    }
    if (!currentEngine) {
      this.logger.debug("No user preferred engine - looking for native");
      currentEngine = engines.find(
        (it) => it.availability.available && this.preferredEngines.native.includes(it.engine)
      );
    }
    if (!currentEngine) {
      this.logger.debug("No native supported engine - looking for virtualized");
      if (os.type() === "Windows_NT" || os.type() === "Darwin") {
        currentEngine = engines.find(
          (it) => it.availability.available && this.preferredEngines.virtualized.includes(it.engine)
        );
      }
    }
    if (!currentEngine) {
      this.logger.debug("No virtualized supported engine - looking for available");
      currentEngine = engines.find((it) => it.availability.available);
    }
    if (!currentEngine) {
      this.logger.error("No engine is supported on this machine - requirements might be incomplete");
    }
    return currentEngine;
  }

  async getCurrentClient() {
    const engine = await this.getCurrentEngine();
    let client;
    if (engine) {
      client = await this.registry.getEngineClientById(engine.id);
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
