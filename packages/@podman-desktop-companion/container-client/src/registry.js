// node
const os = require("os");
// vendors
// project
const { createLogger } = require("@podman-desktop-companion/logger");
// module
// locals

const createEngineConnectorsMap = (userConfiguration, clients) => {
  const engineConnectorsMap = clients.reduce((acc, client) => {
    const id = `engine.default.${client.ENGINE}`;
    acc[id] = new client.ContainerClient(userConfiguration, id);
    return acc;
  }, {});
  return engineConnectorsMap;
};

class Registry {
  constructor(userConfiguration, clients) {
    this.osType = os.type();
    this.userConfiguration = userConfiguration;
    this.logger = createLogger("container-client.Registry");
    this.clients = clients;
    this.engineConnectorsMap = createEngineConnectorsMap(userConfiguration, clients);
  }
  async getDefaultConnectors() {
    const connectors = await Promise.all(
      this.clients.map(async (client) => {
        const id = `engine.default.${client.ENGINE}`;
        const engineClient = this.engineConnectorsMap[id];
        const connector = await engineClient.getConnector();
        connector.settings.current = await engineClient.getCurrentSettings();
        return connector;
      })
    );
    return connectors;
  }
  async getDefaultConnectors() {
    const connectors = await Promise.all(
      this.clients.map(async (client) => {
        const id = `engine.default.${client.ENGINE}`;
        const engineController = this.engineConnectorsMap[id];
        const connector = await engineController.getConnector();
        connector.settings.current = await engineController.getCurrentSettings();
        return connector;
      })
    );
    return connectors;
  }
  async getCustomConnectors() {
    const connectors = [];
    return connectors;
  }
  async getConnectors() {
    const defaults = await this.getDefaultConnectors();
    const custom = await this.getCustomConnectors();
    const items = [...defaults, ...custom];
    return items;
  }
  getConnectorClientById(id) {
    return this.engineConnectorsMap[id];
  }
  updateEngine(id, engine) {
    this.engineConnectorsMap[id] = {
      ...this.engineConnectorsMap[id],
      ...engine,
      id
    };
    return this.engineConnectorsMap[id];
  }
}

module.exports = {
  createEngineConnectorsMap,
  Registry
};
