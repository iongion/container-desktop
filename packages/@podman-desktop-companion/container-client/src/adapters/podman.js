// nodejs
const fs = require("fs");
const path = require("path");
// vendors
const merge = require("lodash.merge");
// project
const { exec_launcher_sync } = require("@podman-desktop-companion/executor");
const userSettings = require("@podman-desktop-companion/user-settings");
// module
const { findProgramVersion } = require("../detector");
const { getAvailablePodmanMachines } = require("../shared");
const {
  // WSL - common
  WSL_PATH,
  WSL_VERSION,
  WSL_DISTRIBUTION,
  // LIMA - common
  LIMA_PATH,
  LIMA_VERSION
} = require("../constants");
const {
  AbstractAdapter,
  AbstractClientEngine,
  AbstractControlledClientEngine,
  AbstractClientEngineSubsystemWSL,
  AbstractClientEngineSubsystemLIMA
} = require("./abstract");
// locals
const PROGRAM = "podman";
const API_BASE_URL = "http://d/v3.0.0/libpod";
const PODMAN_MACHINE_DEFAULT = "podman-machine-default";
// Native
const NATIVE_PODMAN_CLI_PATH = "/usr/bin/podman";
const NATIVE_PODMAN_CLI_VERSION = "4.0.3";
const NATIVE_PODMAN_SOCKET_PATH = path.join(
  userSettings.getPath(),
  `podman-desktop-companion-${PROGRAM}-rest-api.sock`
);
const NATIVE_PODMAN_MACHINE_CLI_VERSION = "4.0.3";
const NATIVE_PODMAN_MACHINE_CLI_PATH = "/usr/bin/podman";
// Windows virtualized
const WINDOWS_PODMAN_NATIVE_CLI_VERSION = "4.0.3-dev";
const WINDOWS_PODMAN_NATIVE_CLI_PATH = "C:\\Program Files\\RedHat\\Podman\\podman.exe";
const WINDOWS_PODMAN_MACHINE_CLI_VERSION = "4.0.3";
const WINDOWS_PODMAN_MACHINE_CLI_PATH = "/usr/bin/podman";
// MacOS virtualized
const MACOS_PODMAN_NATIVE_CLI_VERSION = "4.0.3";
const MACOS_PODMAN_NATIVE_CLI_PATH = "/usr/local/bin/podman";
const MACOS_PODMAN_MACHINE_CLI_VERSION = "4.0.2";
const MACOS_PODMAN_MACHINE_CLI_PATH = "/usr/bin/podman";
// Windows WSL
const WSL_PODMAN_CLI_PATH = "/usr/bin/podman";
const WSL_PODMAN_CLI_VERSION = "3.4.2";
// MacOS LIMA
const LIMA_PODMAN_CLI_PATH = "/usr/bin/podman";
const LIMA_PODMAN_CLI_VERSION = "3.2.1";
const LIMA_PODMAN_INSTANCE = "podman";
// Engines
const ENGINE_PODMAN_NATIVE = `${PROGRAM}.native`;
const ENGINE_PODMAN_VIRTUALIZED = `${PROGRAM}.virtualized`;
const ENGINE_PODMAN_SUBSYSTEM_WSL = `${PROGRAM}.subsystem.wsl`;
const ENGINE_PODMAN_SUBSYSTEM_LIMA = `${PROGRAM}.subsystem.lima`;

class AbstractPodmanControlledClientEngine extends AbstractControlledClientEngine {
  PROGRAM = PROGRAM;
}

class PodmanClientEngineNative extends AbstractClientEngine {
  ENGINE = ENGINE_PODMAN_NATIVE;
  PROGRAM = PROGRAM;
  // Settings
  async getExpectedSettings() {
    return {
      api: {
        baseURL: API_BASE_URL,
        connectionString: NATIVE_PODMAN_SOCKET_PATH
      },
      program: {
        name: PROGRAM,
        path: NATIVE_PODMAN_CLI_PATH,
        version: NATIVE_PODMAN_CLI_VERSION
      }
    };
  }
  async getDetectedSettings(settings) {
    let info = {};
    if (fs.existsSync(settings.program.path)) {
      const detectVersion = await findProgramVersion(settings.program.path || PROGRAM);
      info.program = {
        version: detectVersion
      };
    } else {
      // info = await findProgram(settings.program.name || PROGRAM);
    }
    return info;
  }
  async getUserSettings() {
    return {
      api: {
        baseURL: this.userConfiguration.getKey(`${this.id}.api.baseURL`),
        connectionString: this.userConfiguration.getKey(`${this.id}.api.connectionString`)
      },
      program: {
        path: this.userConfiguration.getKey(`${this.id}.program.path`)
      }
    };
  }
  // Runtime
  async startApi(opts) {
    const running = await this.isApiRunning();
    if (running.success) {
      this.logger.debug("API is already running");
      return true;
    }
    const settings = await this.getCurrentSettings();
    return await this.runner.startApi(opts, {
      path: settings.program.path,
      args: ["system", "service", "--time=0", `unix://${settings.api.connectionString}`, "--log-level=debug"]
    });
  }
  // Availability
  async isEngineAvailable() {
    const result = { success: true, details: "Engine is available" };
    if (this.osType !== "Linux") {
      result.success = false;
      result.details = `Engine is not available on ${this.osType}`;
    }
    return result;
  }
}

class PodmanClientEngineVirtualized extends AbstractPodmanControlledClientEngine {
  ENGINE = ENGINE_PODMAN_VIRTUALIZED;
  PROGRAM = PROGRAM;
  // Helpers
  async getConnectionString(scope) {
    let connectionString = NATIVE_PODMAN_SOCKET_PATH;
    if (this.osType === "Windows_NT") {
      connectionString = `//./pipe/${scope}`;
    } else {
      connectionString = path.join(process.env.HOME, ".local/share/containers/podman/machine/", scope, "podman.sock");
    }
    return connectionString;
  }
  // Settings
  async getExpectedSettings() {
    const connectionString = await this.getConnectionString(PODMAN_MACHINE_DEFAULT);
    const defaults = {
      api: {
        baseURL: API_BASE_URL,
        connectionString: connectionString
      },
      controller: {
        path: undefined,
        version: undefined,
        scope: undefined
      },
      program: {
        name: PROGRAM,
        path: undefined,
        version: undefined
      }
    };
    let config = {};
    if (this.osType === "Linux") {
      config = {
        controller: {
          path: NATIVE_PODMAN_CLI_PATH,
          version: NATIVE_PODMAN_CLI_VERSION,
          scope: PODMAN_MACHINE_DEFAULT
        },
        program: {
          path: NATIVE_PODMAN_MACHINE_CLI_PATH,
          version: NATIVE_PODMAN_MACHINE_CLI_VERSION
        }
      };
    } else if (this.osType === "Windows_NT") {
      config = {
        controller: {
          path: WINDOWS_PODMAN_NATIVE_CLI_PATH,
          version: WINDOWS_PODMAN_NATIVE_CLI_VERSION,
          scope: PODMAN_MACHINE_DEFAULT
        },
        program: {
          path: WINDOWS_PODMAN_MACHINE_CLI_PATH,
          version: WINDOWS_PODMAN_MACHINE_CLI_VERSION
        }
      };
    } else if (this.osType === "Darwin") {
      config = {
        controller: {
          path: MACOS_PODMAN_NATIVE_CLI_PATH,
          version: MACOS_PODMAN_NATIVE_CLI_VERSION,
          scope: PODMAN_MACHINE_DEFAULT
        },
        program: {
          path: MACOS_PODMAN_MACHINE_CLI_PATH,
          version: MACOS_PODMAN_MACHINE_CLI_VERSION
        }
      };
    }
    return merge({}, defaults, {
      api: {
        baseURL: API_BASE_URL,
        connectionString: connectionString
      },
      ...config
    });
  }
  // Runtime
  async startApi(opts) {
    const running = await this.isApiRunning();
    if (running.success) {
      this.logger.debug("API is already running");
      return true;
    }
    const settings = await this.getCurrentSettings();
    // TODO: Safe to stop first before starting ?
    return await this.runner.startApi(opts, {
      path: settings.controller.path,
      args: ["machine", "start", settings.controller.scope]
    });
  }
  async stopApi(opts) {
    const settings = await this.getCurrentSettings();
    return await this.runner.stopApi(opts, {
      path: settings.controller.path,
      args: ["machine", "stop", settings.controller.scope]
    });
  }
  // Availability
  async isEngineAvailable() {
    const result = { success: true, details: "Engine is available" };
    return result;
  }
  async isControllerScopeAvailable() {
    const settings = await this.getCurrentSettings();
    const machines = await getAvailablePodmanMachines(settings.controller.path);
    const target = machines.find((it) => it.Name === settings.controller.scope);
    return target.Running;
  }
  // Executes command inside controller scope
  async runScopedCommand(program, args, opts) {
    const { controller } = await this.getCurrentSettings();
    const command = ["machine", "ssh", controller.scope, "-o", "LogLevel=ERROR", program, ...args];
    const result = await exec_launcher_sync(controller.path, command, opts);
    return result;
  }
}

class PodmanClientEngineSubsystemWSL extends AbstractClientEngineSubsystemWSL {
  ENGINE = ENGINE_PODMAN_SUBSYSTEM_WSL;
  PROGRAM = PROGRAM;
  // Settings
  async getExpectedSettings() {
    return {
      api: {
        baseURL: API_BASE_URL,
        connectionString: API_BASE_URL
      },
      controller: {
        path: WSL_PATH,
        version: WSL_VERSION,
        scope: WSL_DISTRIBUTION
      },
      program: {
        name: PROGRAM,
        path: WSL_PODMAN_CLI_PATH,
        version: WSL_PODMAN_CLI_VERSION
      }
    };
  }
}

class PodmanClientEngineSubsystemLIMA extends AbstractClientEngineSubsystemLIMA {
  ENGINE = ENGINE_PODMAN_SUBSYSTEM_LIMA;
  PROGRAM = PROGRAM;
  // Settings
  async getExpectedSettings() {
    return {
      api: {
        baseURL: API_BASE_URL,
        connectionString: API_BASE_URL
      },
      controller: {
        path: LIMA_PATH,
        version: LIMA_VERSION,
        scope: LIMA_PODMAN_INSTANCE
      },
      program: {
        name: PROGRAM,
        path: LIMA_PODMAN_CLI_PATH,
        version: LIMA_PODMAN_CLI_VERSION
      }
    };
  }
}

class Adapter extends AbstractAdapter {
  ADAPTER = PROGRAM;

  async createEngines() {
    return [
      PodmanClientEngineNative,
      PodmanClientEngineVirtualized,
      PodmanClientEngineSubsystemWSL,
      PodmanClientEngineSubsystemLIMA
    ].map((PodmanClientEngine) => {
      const engine = new PodmanClientEngine(this.userConfiguration, this.osType);
      engine.ADAPTER = PROGRAM;
      engine.id = `engine.default.${engine.ENGINE}`;
      return engine;
    });
  }

  async getMachines(engine, customFormat) {
    let items = [];
    const { program } = await engine.getCurrentSettings();
    const result = await engine.runScopedCommand(program.path, [
      "machine",
      "list",
      "--noheading",
      "--format",
      customFormat || "json"
    ]);
    if (!result.success) {
      this.logger.error("Unable to get list of machines", result);
      return items;
    }
    try {
      items = result.stdout ? JSON.parse(result.stdout) : info;
    } catch (error) {
      this.logger.error("Unable to get list of machines", error, result);
    }
    return items;
  }
}
// Expose as static
Adapter.ADAPTER = PROGRAM;

module.exports = {
  // adapters
  Adapter,
  // engines
  PodmanClientEngineNative,
  PodmanClientEngineVirtualized,
  PodmanClientEngineSubsystemWSL,
  PodmanClientEngineSubsystemLIMA,
  // constants
  PROGRAM,
  ENGINE_PODMAN_NATIVE,
  ENGINE_PODMAN_VIRTUALIZED,
  ENGINE_PODMAN_SUBSYSTEM_WSL,
  ENGINE_PODMAN_SUBSYSTEM_LIMA
};
