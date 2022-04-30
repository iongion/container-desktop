// node
const path = require("path");
// project
// module
const { UserConfiguration } = require("../../src/configuration");
const { Registry } = require("../../src/registry");
const Docker = require("../../src/clients/docker");
const Podman = require("../../src/clients/podman");
// locals
const {
  testOnLinux,
  testOnWindows,
  testOnMacOS
  // ensurePodmanMachineIsRunning,
  // ensureLIMAInstanceIsRunning
} = require("../helpers");

const {
  PODMAN_MACHINE_DEFAULT,
  NATIVE_DOCKER_CLI_PATH,
  NATIVE_PODMAN_CLI_PATH,
  WINDOWS_PODMAN_CLI_VERSION,
  WINDOWS_PODMAN_CLI_PATH,
  WINDOWS_DOCKER_CLI_PATH,
  WINDOWS_PODMAN_NAMED_PIPE,
  WINDOWS_DOCKER_NAMED_PIPE,
  PODMAN_CLI_VERSION,
  DOCKER_CLI_VERSION,
  PODMAN_API_BASE_URL,
  DOCKER_API_BASE_URL,
  NATIVE_DOCKER_SOCKET_PATH,
  NATIVE_PODMAN_SOCKET_PATH,
  // WSL
  WSL_DISTRIBUTION,
  WSL_PATH,
  WSL_PODMAN_CLI_PATH,
  WSL_PODMAN_CLI_VERSION,
  WSL_PODMAN_NAMED_PIPE,
  WSL_DOCKER_NAMED_PIPE,
  // LIMA
  LIMA_PATH,
  LIMA_DOCKER_CLI_PATH,
  LIMA_DOCKER_CLI_VERSION,
  LIMA_PODMAN_CLI_PATH,
  LIMA_PODMAN_CLI_VERSION,
  LIMA_DOCKER_INSTANCE,
  LIMA_PODMAN_INSTANCE,
  LIMA_DOCKER_SOCKET_PATH,
  LIMA_PODMAN_SOCKET_PATH,
  LIMA_INSTANCES
} = require("../fixtures");

jest.setTimeout(50000); // Give time for windows testing VM

// beforeAll(async () => {
//   await ensurePodmanMachineIsRunning();
//   await ensureLIMAInstanceIsRunning();
// });

describe("registry", () => {
  let configuration;
  let registry;
  let expected;
  beforeEach(() => {
    configuration = new UserConfiguration();
    configuration.reset();
    registry = new Registry(configuration, [
      // Podman
      Podman.Native,
      Podman.Virtualized,
      Podman.WSL,
      Podman.LIMA,
      // Docker
      Docker.Native,
      Docker.Virtualized,
      Docker.WSL,
      Docker.LIMA
    ]);
  });
  testOnLinux("getDefaultEngines", async () => {
    const engines = await registry.getEngines();
    // podman native
    expected = engines.find((it) => it.id === "engine.default.podman.native");
    expect(expected).toStrictEqual({
      availability: { available: true, reason: undefined },
      engine: "podman.native",
      id: "engine.default.podman.native",
      program: "podman",
      settings: {
        current: {
          api: {
            baseURL: PODMAN_API_BASE_URL,
            connectionString: NATIVE_PODMAN_SOCKET_PATH
          },
          program: { name: "podman", path: NATIVE_PODMAN_CLI_PATH, version: PODMAN_CLI_VERSION }
        },
        custom: {
          api: {
            baseURL: undefined,
            connectionString: undefined
          },
          program: { name: "podman", path: undefined }
        },
        detect: {
          api: {
            baseURL: PODMAN_API_BASE_URL,
            connectionString: NATIVE_PODMAN_SOCKET_PATH
          },
          program: { name: "podman", path: NATIVE_PODMAN_CLI_PATH, version: PODMAN_CLI_VERSION }
        }
      }
    });
    // podman WSL
    expected = engines.find((it) => it.id === "engine.default.podman.subsystem.wsl");
    expect(expected).toMatchObject({
      availability: { available: false, reason: "Not available on Linux" },
      engine: "podman.subsystem.wsl",
      id: "engine.default.podman.subsystem.wsl",
      program: "podman"
    });
    // podman LIMA
    expected = engines.find((it) => it.id === "engine.default.podman.subsystem.lima");
    expect(expected).toMatchObject({
      availability: { available: false, reason: "Not available on Linux" },
      engine: "podman.subsystem.lima",
      id: "engine.default.podman.subsystem.lima",
      program: "podman"
    });
    // docker native
    expected = engines.find((it) => it.id === "engine.default.docker.native");
    expect(expected).toStrictEqual({
      availability: { available: true, reason: undefined },
      engine: "docker.native",
      id: "engine.default.docker.native",
      program: "docker",
      settings: {
        current: {
          api: {
            baseURL: DOCKER_API_BASE_URL,
            connectionString: NATIVE_DOCKER_SOCKET_PATH
          },
          program: {
            name: "docker",
            path: NATIVE_DOCKER_CLI_PATH,
            version: DOCKER_CLI_VERSION
          }
        },
        custom: {
          api: {
            baseURL: undefined,
            connectionString: undefined
          },
          program: { name: "docker", path: undefined }
        },
        detect: {
          api: {
            baseURL: DOCKER_API_BASE_URL,
            connectionString: NATIVE_DOCKER_SOCKET_PATH
          },
          program: {
            name: "docker",
            path: NATIVE_DOCKER_CLI_PATH,
            version: DOCKER_CLI_VERSION
          }
        }
      }
    });
    // docker WSL
    expected = engines.find((it) => it.id === "engine.default.docker.subsystem.wsl");
    expect(expected).toMatchObject({
      availability: { available: false, reason: "Not available on Linux" },
      engine: "docker.subsystem.wsl",
      id: "engine.default.docker.subsystem.wsl",
      program: "docker"
    });
    // docker LIMA
    expected = engines.find((it) => it.id === "engine.default.docker.subsystem.lima");
    expect(expected).toMatchObject({
      availability: { available: false, reason: "Not available on Linux" },
      engine: "docker.subsystem.lima",
      id: "engine.default.docker.subsystem.lima",
      program: "docker"
    });
  });
  testOnWindows("getDefaultEngines", async () => {
    const engines = await registry.getEngines();
    // podman native
    expected = engines.find((it) => it.id === "engine.default.podman.native");
    expect(expected).toMatchObject({
      availability: { available: false, reason: "Only on Linux" },
      engine: "podman.native",
      id: "engine.default.podman.native",
      program: "podman"
    });
    // podman virtualized
    expected = engines.find((it) => it.id === "engine.default.podman.virtualized");
    expect(expected).toStrictEqual({
      availability: { available: true, reason: undefined },
      engine: "podman.virtualized",
      id: "engine.default.podman.virtualized",
      program: "podman",
      settings: {
        current: {
          api: {
            baseURL: PODMAN_API_BASE_URL,
            connectionString: WINDOWS_PODMAN_NAMED_PIPE
          },
          controller: {
            name: "podman",
            path: WINDOWS_PODMAN_CLI_PATH,
            scope: PODMAN_MACHINE_DEFAULT,
            version: ""
          },
          program: { name: "podman", path: NATIVE_PODMAN_CLI_PATH, version: PODMAN_CLI_VERSION }
        },
        custom: {
          api: {
            baseURL: undefined,
            connectionString: undefined
          },
          controller: {
            name: "podman",
            path: undefined,
            scope: undefined
          },
          program: { name: "podman", path: undefined }
        },
        detect: {
          api: {
            baseURL: PODMAN_API_BASE_URL,
            connectionString: WINDOWS_PODMAN_NAMED_PIPE
          },
          controller: {
            name: "podman",
            path: WINDOWS_PODMAN_CLI_PATH,
            scope: PODMAN_MACHINE_DEFAULT,
            version: ""
          },
          program: { name: "podman", path: NATIVE_PODMAN_CLI_PATH, version: PODMAN_CLI_VERSION }
        }
      }
    });
    // podman WSL
    expected = engines.find((it) => it.id === "engine.default.podman.subsystem.wsl");
    expect(expected).toStrictEqual({
      availability: { available: true, reason: undefined },
      engine: "podman.subsystem.wsl",
      id: "engine.default.podman.subsystem.wsl",
      program: "podman",
      settings: {
        current: {
          api: {
            baseURL: PODMAN_API_BASE_URL,
            connectionString: WSL_PODMAN_NAMED_PIPE
          },
          controller: {
            name: "wsl",
            path: WSL_PATH,
            scope: WSL_DISTRIBUTION,
            version: ""
          },
          program: { name: "podman", path: WSL_PODMAN_CLI_PATH, version: WSL_PODMAN_CLI_VERSION }
        },
        custom: {
          api: {
            baseURL: undefined,
            connectionString: undefined
          },
          controller: { name: "wsl", path: undefined, scope: undefined },
          program: { name: "podman", path: undefined }
        },
        detect: {
          api: {
            baseURL: PODMAN_API_BASE_URL,
            connectionString: WSL_PODMAN_NAMED_PIPE
          },
          controller: {
            name: "wsl",
            path: WSL_PATH,
            scope: WSL_DISTRIBUTION,
            version: ""
          },
          program: { name: "podman", path: WSL_PODMAN_CLI_PATH, version: WSL_PODMAN_CLI_VERSION }
        }
      }
    });
    // podman LIMA
    expected = engines.find((it) => it.id === "engine.default.podman.subsystem.lima");
    expect(expected).toMatchObject({
      availability: { available: false, reason: "Not available on Windows_NT" },
      engine: "podman.subsystem.lima",
      id: "engine.default.podman.subsystem.lima",
      program: "podman"
    });
    // docker native
    expected = engines.find((it) => it.id === "engine.default.docker.native");
    expect(expected).toMatchObject({
      availability: { available: false, reason: "Only on Linux" },
      engine: "docker.native",
      id: "engine.default.docker.native",
      program: "docker"
    });
    // docker virtualized
    expected = engines.find((it) => it.id === "engine.default.docker.virtualized");
    expect(expected).toStrictEqual({
      availability: { available: true, reason: undefined },
      engine: "docker.virtualized",
      id: "engine.default.docker.virtualized",
      program: "docker",
      settings: {
        current: {
          api: {
            baseURL: DOCKER_API_BASE_URL,
            connectionString: WINDOWS_DOCKER_NAMED_PIPE
          },
          program: {
            name: "docker",
            path: WINDOWS_DOCKER_CLI_PATH,
            version: WINDOWS_DOCKER_CLI_VERSION
          }
        },
        custom: {
          api: {
            baseURL: undefined,
            connectionString: undefined
          },
          program: { name: "docker", path: undefined }
        },
        detect: {
          api: {
            baseURL: DOCKER_API_BASE_URL,
            connectionString: WINDOWS_DOCKER_NAMED_PIPE
          },
          program: {
            name: "docker",
            path: WINDOWS_DOCKER_CLI_PATH,
            version: DOCKER_CLI_VERSION
          }
        }
      }
    });
    // docker WSL
    expected = engines.find((it) => it.id === "engine.default.docker.subsystem.wsl");
    expect(expected).toStrictEqual({
      availability: { available: true, reason: undefined },
      engine: "docker.subsystem.wsl",
      id: "engine.default.docker.subsystem.wsl",
      program: "docker",
      settings: {
        current: {
          api: {
            baseURL: DOCKER_API_BASE_URL,
            connectionString: WSL_DOCKER_NAMED_PIPE
          },
          controller: {
            name: "wsl",
            path: WSL_PATH,
            scope: WSL_DISTRIBUTION,
            version: ""
          },
          program: {
            name: "docker",
            path: WSL_DOCKER_CLI_PATH,
            version: WSL_DOCKER_CLI_VERSION
          }
        },
        custom: {
          api: {
            baseURL: undefined,
            connectionString: undefined
          },
          controller: { name: "wsl", path: undefined, scope: undefined },
          program: { name: "docker", path: undefined }
        },
        detect: {
          api: {
            baseURL: DOCKER_API_BASE_URL,
            connectionString: WSL_DOCKER_NAMED_PIPE
          },
          controller: {
            name: "wsl",
            path: WSL_PATH,
            scope: WSL_DISTRIBUTION,
            version: ""
          },
          program: {
            name: "docker",
            path: WSL_DOCKER_CLI_PATH,
            version: WSL_DOCKER_CLI_VERSION
          }
        }
      }
    });
    // docker LIMA
    expected = engines.find((it) => it.id === "engine.default.docker.subsystem.lima");
    expect(expected).toMatchObject({
      availability: { available: false, reason: "Not available on Windows_NT" },
      engine: "docker.subsystem.lima",
      id: "engine.default.docker.subsystem.lima",
      program: "docker"
    });
  });
  testOnMacOS("getDefaultEngines", async () => {
    const engines = await registry.getEngines();
    // podman native
    expected = engines.find((it) => it.id === "engine.default.podman.native");
    expect(expected).toMatchObject({
      availability: { available: false, reason: "Only on Linux" },
      engine: "podman.native",
      id: "engine.default.podman.native",
      program: "podman"
    });
    // podman WSL
    expected = engines.find((it) => it.id === "engine.default.podman.subsystem.wsl");
    expect(expected).toMatchObject({
      availability: { available: false, reason: "Not available on Darwin" },
      engine: "podman.subsystem.wsl",
      id: "engine.default.podman.subsystem.wsl",
      program: "podman"
    });
    // podman LIMA
    expected = engines.find((it) => it.id === "engine.default.podman.subsystem.lima");
    expect(expected).toStrictEqual({
      availability: { available: true, reason: undefined },
      engine: "podman.subsystem.lima",
      id: "engine.default.podman.subsystem.lima",
      program: "podman",
      settings: {
        current: {
          api: {
            baseURL: PODMAN_API_BASE_URL,
            connectionString: LIMA_PODMAN_SOCKET_PATH
          },
          controller: {
            name: "limactl",
            path: LIMA_PATH,
            scope: LIMA_PODMAN_INSTANCE,
            version: ""
          },
          program: { name: "podman", path: LIMA_PODMAN_CLI_PATH, version: LIMA_PODMAN_CLI_VERSION }
        },
        custom: {
          api: {
            baseURL: undefined,
            connectionString: undefined
          },
          controller: { name: "limactl", path: undefined, scope: undefined },
          program: { name: "podman", path: undefined }
        },
        detect: {
          api: {
            baseURL: PODMAN_API_BASE_URL,
            connectionString: LIMA_PODMAN_SOCKET_PATH
          },
          controller: {
            name: "limactl",
            path: LIMA_PATH,
            scope: LIMA_PODMAN_INSTANCE,
            version: ""
          },
          program: { name: "podman", path: LIMA_PODMAN_CLI_PATH, version: LIMA_PODMAN_CLI_VERSION }
        }
      }
    });
    // docker native
    expected = engines.find((it) => it.id === "engine.default.docker.native");
    expect(expected).toMatchObject({
      availability: { available: false, reason: "Only on Linux" },
      engine: "docker.native",
      id: "engine.default.docker.native",
      program: "docker"
    });
    // docker WSL
    expected = engines.find((it) => it.id === "engine.default.docker.subsystem.wsl");
    expect(expected).toMatchObject({
      availability: { available: false, reason: "Not available on Darwin" },
      engine: "docker.subsystem.wsl",
      id: "engine.default.docker.subsystem.wsl",
      program: "docker"
    });
    // docker LIMA
    expected = engines.find((it) => it.id === "engine.default.docker.subsystem.lima");
    expect(expected).toStrictEqual({
      availability: { available: true, reason: undefined },
      engine: "docker.subsystem.lima",
      id: "engine.default.docker.subsystem.lima",
      program: "docker",
      settings: {
        current: {
          api: {
            baseURL: DOCKER_API_BASE_URL,
            connectionString: LIMA_DOCKER_SOCKET_PATH
          },
          controller: {
            name: "limactl",
            path: LIMA_PATH,
            scope: LIMA_DOCKER_INSTANCE,
            version: ""
          },
          program: {
            name: "docker",
            path: LIMA_DOCKER_CLI_PATH,
            version: LIMA_DOCKER_CLI_VERSION
          }
        },
        custom: {
          api: {
            baseURL: undefined,
            connectionString: undefined
          },
          controller: { name: "limactl", path: undefined, scope: undefined },
          program: { name: "docker", path: undefined }
        },
        detect: {
          api: {
            baseURL: DOCKER_API_BASE_URL,
            connectionString: LIMA_DOCKER_SOCKET_PATH
          },
          controller: {
            name: "limactl",
            path: LIMA_PATH,
            scope: LIMA_DOCKER_INSTANCE,
            version: ""
          },
          program: {
            name: "docker",
            path: LIMA_DOCKER_CLI_PATH,
            version: LIMA_DOCKER_CLI_VERSION
          }
        }
      }
    });
  });
});
