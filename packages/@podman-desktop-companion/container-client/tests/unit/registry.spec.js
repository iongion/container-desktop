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
  testOnMacOS,
  ensurePodmanMachineIsRunning,
  ensureLIMAInstanceIsRunning
} = require("../helpers");

jest.setTimeout(120000);

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
            baseURL: "http://d/v3.0.0/libpod",
            connectionString: "/tmp/podman-desktop-companion-podman-rest-api.sock"
          },
          program: { name: "podman", path: "/usr/bin/podman", version: "4.0.3" }
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
            baseURL: "http://d/v3.0.0/libpod",
            connectionString: "/tmp/podman-desktop-companion-podman-rest-api.sock"
          },
          program: { name: "podman", path: "/usr/bin/podman", version: "4.0.3" }
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
            baseURL: "http://localhost",
            connectionString: "/var/run/docker.sock"
          },
          program: {
            name: "docker",
            path: "/usr/bin/docker",
            version: "20.10.14"
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
            baseURL: "http://localhost",
            connectionString: "/var/run/docker.sock"
          },
          program: {
            name: "docker",
            path: "/usr/bin/docker",
            version: "20.10.14"
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
            baseURL: "http://d/v3.0.0/libpod",
            connectionString: "//./pipe/podman-machine-default"
          },
          controller: {
            name: "podman",
            path: "C:\\Program Files\\RedHat\\Podman\\podman.exe",
            scope: "podman-machine-default",
            version: ""
          },
          program: { name: "podman", path: "/usr/bin/podman", version: "4.0.3" }
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
            baseURL: "http://d/v3.0.0/libpod",
            connectionString: "//./pipe/podman-machine-default"
          },
          controller: {
            name: "podman",
            path: "C:\\Program Files\\RedHat\\Podman\\podman.exe",
            scope: "podman-machine-default",
            version: ""
          },
          program: { name: "podman", path: "/usr/bin/podman", version: "4.0.3" }
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
            baseURL: "http://d/v3.0.0/libpod",
            connectionString: "//./pipe/ubuntu-20.04"
          },
          controller: {
            name: "wsl",
            path: "C:\\Windows\\System32\\wsl.exe",
            scope: "ubuntu-20.04",
            version: ""
          },
          program: { name: "podman", path: "/usr/bin/podman", version: "3.4.2" }
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
            baseURL: "http://d/v3.0.0/libpod",
            connectionString: "//./pipe/ubuntu-20.04"
          },
          controller: {
            name: "wsl",
            path: "C:\\Windows\\System32\\wsl.exe",
            scope: "ubuntu-20.04",
            version: ""
          },
          program: { name: "podman", path: "/usr/bin/podman", version: "3.4.2" }
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
            baseURL: "http://localhost",
            connectionString: "//./pipe/docker_engine"
          },
          program: {
            name: "docker",
            path: "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
            version: "20.10.14"
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
            baseURL: "http://localhost",
            connectionString: "//./pipe/docker_engine"
          },
          program: {
            name: "docker",
            path: "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
            version: "20.10.14"
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
            baseURL: "http://localhost",
            connectionString: "//./pipe/ubuntu-20.04"
          },
          controller: {
            name: "wsl",
            path: "C:\\Windows\\System32\\wsl.exe",
            scope: "ubuntu-20.04",
            version: ""
          },
          program: {
            name: "docker",
            path: "/usr/bin/docker",
            version: "20.10.14"
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
            baseURL: "http://localhost",
            connectionString: "//./pipe/ubuntu-20.04"
          },
          controller: {
            name: "wsl",
            path: "C:\\Windows\\System32\\wsl.exe",
            scope: "ubuntu-20.04",
            version: ""
          },
          program: {
            name: "docker",
            path: "/usr/bin/docker",
            version: "20.10.14"
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
            baseURL: "http://d/v3.0.0/libpod",
            connectionString: path.join(process.env.HOME, ".lima/podman/sock/podman.sock")
          },
          controller: {
            name: "limactl",
            path: "/usr/local/bin/limactl",
            scope: "podman",
            version: ""
          },
          program: { name: "podman", path: "/usr/bin/podman", version: "3.2.1" }
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
            baseURL: "http://d/v3.0.0/libpod",
            connectionString: path.join(process.env.HOME, ".lima/podman/sock/podman.sock")
          },
          controller: {
            name: "limactl",
            path: "/usr/local/bin/limactl",
            scope: "podman",
            version: ""
          },
          program: { name: "podman", path: "/usr/bin/podman", version: "3.2.1" }
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
            baseURL: "http://localhost",
            connectionString: path.join(process.env.HOME, ".lima/docker/sock/docker.sock")
          },
          controller: {
            name: "limactl",
            path: "/usr/local/bin/limactl",
            scope: "docker",
            version: ""
          },
          program: {
            name: "docker",
            path: "/usr/bin/docker",
            version: "20.10.14"
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
            baseURL: "http://localhost",
            connectionString: path.join(process.env.HOME, ".lima/docker/sock/docker.sock")
          },
          controller: {
            name: "limactl",
            path: "/usr/local/bin/limactl",
            scope: "docker",
            version: ""
          },
          program: {
            name: "docker",
            path: "/usr/bin/docker",
            version: "20.10.14"
          }
        }
      }
    });
  });
});
