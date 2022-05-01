// node
const os = require("os");
// vendors
const merge = require("lodash.merge");
// project
const { createLogger } = require("@podman-desktop-companion/logger");
// module
// locals

class Registry {
  constructor(userConfiguration, clients) {
    this.osType = os.type();
    this.userConfiguration = userConfiguration;
    this.logger = createLogger("container-client.Registry");
    this.clients = clients;
    this.engineClientsMap = {};
  }
  async getDefaultEngines() {
    const engines = await Promise.all(
      this.clients.map(async (client) => {
        const id = `engine.default.${client.ENGINE}`;
        if (!this.engineClientsMap[client.ENGINE]) {
          this.engineClientsMap[client.ENGINE] = new client.ContainerClient(this.userConfiguration, id);
        }
        const engineController = this.engineClientsMap[client.ENGINE];
        const engine = await engineController.getEngine();
        engine.settings.current = await engineController.getCurrentSettings();
        return engine;
      })
    );
    return engines;
  }
  async getCustomEngines() {
    const engines = [];
    return engines;
  }
  async getEngines() {
    const defaults = await this.getDefaultEngines();
    const custom = await this.getCustomEngines();
    const items = [...defaults, ...custom];
    return items;
  }
}

module.exports = {
  Registry
};