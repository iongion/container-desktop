// node
const fs = require("fs");
const path = require("path");
const merge = require("lodash.merge");
// vendors
const { Docker, Podman } = require("@podman-desktop-companion/container-client").adapters;
const { createLogger } = require("@podman-desktop-companion/logger");
// locals
const logger = createLogger("bridge.registry");

const AUTOMATIC_REGISTRIES = [
  {
    id: "system",
    name: "Podman configuration",
    created: new Date().toISOString(),
    weight: -1,
    isRemovable: false,
    isSystem: true,
    enabled: true
  }
  // TODO: CRC registries
];

const PROPOSED_REGISTRIES = [
  {
    id: "quay.io",
    name: "quay.io",
    created: new Date().toISOString(),
    weight: 0,
    isRemovable: true,
    isSystem: false,
    enabled: true
  },
  {
    id: "docker.io",
    name: "docker.io",
    created: new Date().toISOString(),
    weight: 1000,
    isRemovable: true,
    isSystem: false,
    enabled: true
  }
];

const getRegistriesMap = async (currentApi, userConfiguration) => {
  const isPodman = currentApi.engine.ADAPTER === Podman.Adapter.ADAPTER;
  const customRegistriesPath = path.join(userConfiguration.getStoragePath(), "registries.json");
  const registriesMap = {
    default: AUTOMATIC_REGISTRIES.map((it) => (it.id === "system" && !isPodman ? { ...it, enabled: false } : it)),
    custom: PROPOSED_REGISTRIES
  };
  if (fs.existsSync(customRegistriesPath)) {
    const custom = JSON.parse(fs.readFileSync(customRegistriesPath).toString());
    if (custom.length) {
      registriesMap.custom = custom;
    }
  }
  return registriesMap;
};

const setRegistriesMap = async (currentApi, userConfiguration, registries) => {
  const customRegistriesPath = path.join(userConfiguration.getStoragePath(), "registries.json");
  fs.writeFileSync(customRegistriesPath, JSON.stringify(registries.custom));
  return getRegistriesMap(currentApi, userConfiguration);
};

const coerceAndSortSearchResults = (items) => {
  items = items.map((it) => {
    if (typeof it.Stars === "undefined") {
      it.Stars = 0;
      if (typeof it.StarCount !== "undefined") {
        it.Stars = Number(it.StarCount);
      }
    }
    return it;
  });
  // 1st sort by name
  items = items.sort((a, b) => {
    return a.Name.localeCompare(b.Name, "en", { numeric: true });
  });
  // 2nd sort by stars
  items = items.sort((a, b) => {
    return b.Stars - a.Stars;
  });
  return items;
};

const searchRegistry = async (currentApi, { filters, term, registry }) => {
  logger.debug("searchRegistry", { filters, term, registry });
  let items = [];
  const { program } = await currentApi.engine.getCurrentSettings();
  const filtersList = [];
  const programArgs = ["search"];
  const isPodman = currentApi.engine.ADAPTER === Podman.Adapter.ADAPTER;
  const isDocker = currentApi.engine.ADAPTER === Docker.Adapter.ADAPTER;
  if (isPodman) {
    // Search using API
    if (registry.id === "system") {
      const driver = await currentApi.engine.getApiDriver(currentApi.connector.settings.current.api);
      const searchParams = new URLSearchParams();
      searchParams.set("term", term);
      // searchParams.set("listTags", "true");
      if (filters?.isAutomated) {
        searchParams.set("is-automated", "true");
      }
      if (filters?.isOfficial) {
        searchParams.set("is-official", "true");
      }
      const request = {
        method: "GET",
        url: `/images/search?${searchParams.toString()}`
      };
      logger.debug("Proxying request", request);
      const response = await driver.request(request);
      items = response.data || [];
      // logger.debug("Results are", output);
      return coerceAndSortSearchResults(items);
    }
    if (filters?.isOfficial) {
      filtersList.push("--filter=is-official");
    }
    if (filters?.isAutomated) {
      filtersList.push("--filter=is-automated");
    }
    // Search using CLI
    programArgs.push(...filtersList);
    programArgs.push(...[`${registry.name}/${term}`, "--format", "json"]);
  } else if (isDocker) {
    if (filters?.isOfficial) {
      filtersList.push("--filter", "is-official=[OK]");
    }
    if (filters?.isAutomated) {
      filtersList.push("--filter", "is-automated=[OK]");
    }
    programArgs.push(...filtersList);
    programArgs.push(...[`${registry.name}/${term}`, "--format", "{{json .}}"]);
  }
  const result = await currentApi.engine.runScopedCommand(program.path, programArgs);
  if (!result.success) {
    logger.error("Unable to search", { term, registry }, result);
  } else {
    try {
      let output = isDocker ? `[${result.stdout.trim().split(/\r?\n/).join(",")}]` : result.stdout;
      if (output) {
        items = JSON.parse(output);
      } else {
        logger.warn("Empty output", result);
      }
    } catch (error) {
      logger.error("Search results parsing error", error.message, error.stack);
    }
  }
  return coerceAndSortSearchResults(items);
};

const pullFromRegistry = async (currentApi, { image, onProgress }) => {
  logger.debug("pull from registry", image);
  const { program } = await currentApi.engine.getCurrentSettings();
  const result = await currentApi.engine.runScopedCommand(program.path, ["image", "pull", image]);
  return result;
};

function createActions(context, { userConfiguration }) {
  // Do not access the context at creation - it is lazy
  return {
    getRegistriesMap: (...rest) => getRegistriesMap(context.getCurrentApi(), userConfiguration),
    setRegistriesMap: (...rest) => setRegistriesMap(context.getCurrentApi(), userConfiguration, ...rest),
    searchRegistry: (...rest) => searchRegistry(context.getCurrentApi(), ...rest),
    pullFromRegistry: (...rest) => pullFromRegistry(context.getCurrentApi(), ...rest)
  };
}

module.exports = {
  getRegistriesMap,
  setRegistriesMap,
  searchRegistry,
  pullFromRegistry,
  createActions
};
