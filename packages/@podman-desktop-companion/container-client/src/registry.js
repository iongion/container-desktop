// node
const os = require("os");
// vendors
// project
const { createLogger } = require("@podman-desktop-companion/logger");
// module
// locals

const createEngineClientsMap = (userConfiguration, clients) => {
  const engineClientsMap = clients.reduce((acc, client) => {
    const id = `engine.default.${client.ENGINE}`;
    acc[id] = new client.ContainerClient(userConfiguration, id);
    return acc;
  }, {});
  return engineClientsMap;
};

class Registry {
  constructor(userConfiguration, clients) {
    this.osType = os.type();
    this.userConfiguration = userConfiguration;
    this.logger = createLogger("container-client.Registry");
    this.clients = clients;
    this.engineClientsMap = createEngineClientsMap(userConfiguration, clients);
  }
  async getDefaultEngines() {
    const engines = await Promise.all(
      this.clients.map(async (client) => {
        const id = `engine.default.${client.ENGINE}`;
        const engineClient = this.engineClientsMap[id];
        const engine = await engineClient.getEngine();
        engine.settings.current = await engineClient.getCurrentSettings();
        return engine;
      })
    );
    return engines;
  }
  async getDefaultEngines() {
    const engines = await Promise.all(
      this.clients.map(async (client) => {
        const id = `engine.default.${client.ENGINE}`;
        const engineController = this.engineClientsMap[id];
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
  getEngineClientById(id) {
    return this.engineClientsMap[id];
  }
  updateEngine(id, engine) {
    this.engineClientsMap[id] = {
      ...this.engineClientsMap[id],
      ...engine,
      id
    };
    return this.engineClientsMap[id];
  }
}

module.exports = {
  createEngineClientsMap,
  Registry
};
