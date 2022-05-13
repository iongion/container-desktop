const { Podman, Docker } = require("@podman-desktop-companion/container-client").adapters;

const DEFAULT_CONNECTORS = [
  // Podman
  {
    adapter: Podman.Adapter.ADAPTER,
    engine: Podman.ENGINE_PODMAN_NATIVE,
    id: "engine.default.podman.native",
    availability: {
      all: false,
      api: false,
      engine: false,
      program: false,
      api: false,
      report: {
        engine: "Not checked",
        program: "Not checked",
        api: "Not checked"
      }
    },
    settings: {
      expected: {},
      user: {},
      current: {
        api: {
          baseURL: "",
          connectionString: ""
        },
        program: {
          name: "podman",
          path: undefined,
          version: undefined
        }
      }
    }
  },
  {
    adapter: Podman.Adapter.ADAPTER,
    engine: Podman.ENGINE_PODMAN_VIRTUALIZED,
    id: "engine.default.podman.virtualized",
    availability: {
      all: false,
      api: false,
      engine: false,
      program: false,
      controller: false,
      api: false,
      report: {
        engine: "Not checked",
        program: "Not checked",
        api: "Not checked",
        controller: "Not checked"
      }
    },
    settings: {
      expected: {},
      user: {},
      current: {
        api: {
          baseURL: "",
          connectionString: ""
        },
        program: {
          name: "podman",
          path: undefined,
          version: undefined
        },
        controller: {
          name: "podman",
          path: undefined,
          version: undefined
        }
      }
    }
  },
  // Docker
  {
    adapter: Docker.Adapter.ADAPTER,
    engine: Docker.ENGINE_DOCKER_NATIVE,
    id: "engine.default.docker.native",
    availability: {
      all: false,
      api: false,
      engine: false,
      program: false,
      api: false,
      report: {
        engine: "Not checked",
        program: "Not checked",
        api: "Not checked"
      }
    },
    settings: {
      expected: {},
      user: {},
      current: {
        api: {
          baseURL: "",
          connectionString: ""
        },
        program: {
          name: "docker",
          path: undefined,
          version: undefined
        }
      }
    }
  },
  {
    adapter: Docker.Adapter.ADAPTER,
    engine: Docker.ENGINE_DOCKER_VIRTUALIZED,
    id: "engine.default.docker.virtualized",
    availability: {
      all: false,
      api: false,
      engine: false,
      program: false,
      controller: false,
      api: false,
      report: {
        engine: "Not checked",
        program: "Not checked",
        api: "Not checked",
        controller: "Not checked"
      }
    },
    settings: {
      expected: {},
      user: {},
      current: {
        api: {
          baseURL: "",
          connectionString: ""
        },
        program: {
          name: "docker",
          path: undefined,
          version: undefined
        },
        controller: {
          name: "docker",
          path: undefined,
          version: undefined
        }
      }
    }
  }
];

function getDefaultDescriptor(opts) {
  // THIS MUST NEVER FAIL
  const osType = opts.osType;
  const version = opts.version;
  const environment = opts.environment;
  const defaultConnectorId = osType === "Linux" ? "engine.default.podman.native" : "engine.default.podman.virtualized";
  return {
    environment: environment,
    version: version,
    platform: osType,
    provisioned: !!opts?.provisioned,
    running: !!opts?.provisioned,
    connectors: DEFAULT_CONNECTORS,
    currentConnector: DEFAULT_CONNECTORS.find((it) => it.id === defaultConnectorId)
  };
}

module.exports = {
  getDefaultDescriptor
};
