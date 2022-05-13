// project
const { createLogger } = require("@podman-desktop-companion/logger");
const { UserConfiguration } = require("@podman-desktop-companion/container-config");
// module
const { getEngines } = require("./engines");
// locals
const logger = createLogger("bridge.connectors");

async function getConnectors() {
  const connectors = [];
  await Promise.all(
    getEngines().map(async (engine) => {
      try {
        const connector = await engine.getConnector();
        connectors.push(connector);
      } catch (error) {
        logger.error("Unable to get engine connector", engine.ENGINE, error.message, error.stack);
      }
    })
  );
  return connectors;
}

async function getCurrentConnector() {
  const connectors = await getConnectors();
  // decide current connector
  let currentConnector;
  // if from start function argument
  let userConnector = opts?.id;
  // if from saved preferences
  if (!userConnector) {
    userConnector = UserConfiguration.getInstance().getKey("connector.default");
  }
  if (userConnector) {
    currentConnector = connectors.find((it) => it.id === userConnector);
  }
  // if none found - default
  if (!currentConnector) {
    logger.debug("No default user connector - picking preferred(favor podman)");
    const defaultConnectorId =
      osType === "Linux" ? "engine.default.podman.native" : "engine.default.podman.virtualized";
    currentConnector = connectors.find(({ id }) => {
      return id === defaultConnectorId;
    });
  }
  if (!currentConnector) {
    logger.warn("Defaulting to first connector");
    currentConnector = connectors[0];
  }
  return currentConnector;
}

module.exports = {
  getConnectors,
  getCurrentConnector
};
