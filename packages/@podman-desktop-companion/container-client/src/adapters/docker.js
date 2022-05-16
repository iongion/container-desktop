// nodejs
const fs = require("fs");
// vendors
const merge = require("lodash.merge");
// project
const { findProgram } = require("@podman-desktop-companion/detector");
// module
const {
  // WSL - common
  WSL_PROGRAM,
  WSL_PATH,
  WSL_VERSION,
  WSL_DISTRIBUTION,
  // LIMA - common
  LIMA_PROGRAM,
  LIMA_PATH,
  LIMA_VERSION
} = require("../constants");
const {
  AbstractAdapter,
  AbstractClientEngine,
  // AbstractControlledClientEngine,
  AbstractClientEngineSubsystemWSL,
  AbstractClientEngineSubsystemLIMA
} = require("./abstract");
// locals
const PROGRAM = "docker";
const API_BASE_URL = "http://localhost";
const DOCKER_SCOPE_DEFAULT = "docker_engine";
// Native
const NATIVE_DOCKER_CLI_PATH = "/usr/bin/docker";
const NATIVE_DOCKER_CLI_VERSION = "20.10.14";
const NATIVE_DOCKER_SOCKET_PATH = `/var/run/${PROGRAM}.sock`;
// Windows virtualized
const WINDOWS_DOCKER_NATIVE_CLI_VERSION = "20.10.14";
const WINDOWS_DOCKER_NATIVE_CLI_PATH = "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe";
const WINDOWS_DOCKER_NATIVE_SOCKET_PATH = `//./pipe/${DOCKER_SCOPE_DEFAULT}`;
// MacOS virtualized
const MACOS_DOCKER_NATIVE_CLI_VERSION = "20.10.8";
const MACOS_DOCKER_NATIVE_CLI_PATH = "/usr/local/bin/docker";
const MACOS_DOCKER_NATIVE_SOCKET_PATH = `/var/run/${PROGRAM}.sock`;
// Windows WSL
const WSL_DOCKER_CLI_PATH = "/usr/bin/docker";
const WSL_DOCKER_CLI_VERSION = "20.10.14";
// MacOS LIMA
const LIMA_DOCKER_CLI_PATH = "/usr/bin/docker";
const LIMA_DOCKER_CLI_VERSION = "20.10.14";
const LIMA_DOCKER_INSTANCE = "docker";
// Engines
const ENGINE_DOCKER_NATIVE = `${PROGRAM}.native`;
const ENGINE_DOCKER_VIRTUALIZED = `${PROGRAM}.virtualized`;
const ENGINE_DOCKER_SUBSYSTEM_WSL = `${PROGRAM}.subsystem.wsl`;
const ENGINE_DOCKER_SUBSYSTEM_LIMA = `${PROGRAM}.subsystem.lima`;

class DockerClientEngineNative extends AbstractClientEngine {
  static ENGINE = ENGINE_DOCKER_NATIVE;
  ENGINE = ENGINE_DOCKER_NATIVE;
  PROGRAM = PROGRAM;

  static create(id, userConfiguration, osType) {
    const instance = new DockerClientEngineNative(userConfiguration, osType);
    instance.id = `engine.${id}.${instance.ENGINE}`;
    instance.ADAPTER = PROGRAM;
    instance.setup();
    return instance;
  }

  // Settings
  async getExpectedSettings() {
    return {
      api: {
        baseURL: API_BASE_URL,
        connectionString: NATIVE_DOCKER_SOCKET_PATH
      },
      program: {
        name: PROGRAM,
        path: NATIVE_DOCKER_CLI_PATH,
        version: NATIVE_DOCKER_CLI_VERSION
      }
    };
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

  async getDetectedSettings(expected) {
    const detected = {
      program: {
        name: expected.program.name,
        path: undefined,
        version: undefined
      }
    };
    const available = await this.isEngineAvailable();
    if (available.success) {
      try {
        const program = await findProgram(expected.program.name, { osType: this.osType });
        detected.program.name = expected.program.name;
        detected.program.path = program.path;
        detected.program.version = program.version;
      } catch (error) {
        this.logger.error(`Unable to find ${expected.program.name}`, error.message, error.stack);
      }
    }
    return detected;
  }
  // Runtime
  async startApi(customSettings, opts) {
    const running = await this.isApiRunning(customSettings);
    if (running.success) {
      this.logger.debug("API is running");
      return true;
    }
    this.logger.error(this.id, "Start api failed - must start engine manually");
    return false;
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
  // System information
  async getSystemInfo() {
    return super.getSystemInfo("{{ json . }}");
  }
}

class DockerClientEngineVirtualized extends DockerClientEngineNative {
  static ENGINE = ENGINE_DOCKER_VIRTUALIZED;
  ENGINE = ENGINE_DOCKER_VIRTUALIZED;
  PROGRAM = PROGRAM;

  static create(id, userConfiguration, osType) {
    const instance = new DockerClientEngineVirtualized(userConfiguration, osType);
    instance.id = `engine.${id}.${instance.ENGINE}`;
    instance.ADAPTER = PROGRAM;
    instance.setup();
    return instance;
  }

  // Settings
  async getExpectedSettings() {
    let settings = {};
    if (this.osType === "Linux") {
      settings = {
        api: {
          connectionString: NATIVE_DOCKER_SOCKET_PATH
        },
        program: {
          name: PROGRAM,
          path: NATIVE_DOCKER_CLI_PATH,
          version: NATIVE_DOCKER_CLI_VERSION
        }
      };
    } else if (this.osType === "Windows_NT") {
      settings = {
        api: {
          connectionString: WINDOWS_DOCKER_NATIVE_SOCKET_PATH
        },
        program: {
          name: PROGRAM,
          path: WINDOWS_DOCKER_NATIVE_CLI_PATH,
          version: WINDOWS_DOCKER_NATIVE_CLI_VERSION
        }
      };
    } else if (this.osType === "Darwin") {
      settings = {
        api: {
          connectionString: MACOS_DOCKER_NATIVE_SOCKET_PATH
        },
        program: {
          name: PROGRAM,
          path: MACOS_DOCKER_NATIVE_CLI_PATH,
          version: MACOS_DOCKER_NATIVE_CLI_VERSION
        }
      };
    }
    return merge(
      {
        api: {
          baseURL: API_BASE_URL
        },
        program: {
          name: PROGRAM
        }
      },
      settings
    );
  }
  // Availability
  async isEngineAvailable() {
    const result = { success: true, details: "Engine is available" };
    if (this.osType === "Linux") {
      result.success = false;
      result.details = `Engine is not available on ${this.osType}`;
    }
    return result;
  }
}

class DockerClientEngineSubsystemWSL extends AbstractClientEngineSubsystemWSL {
  static ENGINE = ENGINE_DOCKER_SUBSYSTEM_WSL;
  ENGINE = ENGINE_DOCKER_SUBSYSTEM_WSL;
  PROGRAM = PROGRAM;

  static create(id, userConfiguration, osType) {
    const instance = new DockerClientEngineSubsystemWSL(userConfiguration, osType);
    instance.id = `engine.${id}.${instance.ENGINE}`;
    instance.ADAPTER = PROGRAM;
    instance.setup();
    return instance;
  }

  // Settings
  async getExpectedSettings() {
    return {
      api: {
        baseURL: API_BASE_URL,
        connectionString: NATIVE_DOCKER_SOCKET_PATH
      },
      controller: {
        name: WSL_PROGRAM,
        path: WSL_PATH,
        version: WSL_VERSION,
        scope: WSL_DISTRIBUTION
      },
      program: {
        name: PROGRAM,
        path: WSL_DOCKER_CLI_PATH,
        version: WSL_DOCKER_CLI_VERSION
      }
    };
  }
  // System information
  async getSystemInfo() {
    return super.getSystemInfo("{{ json . }}");
  }
}

class DockerClientEngineSubsystemLIMA extends AbstractClientEngineSubsystemLIMA {
  static ENGINE = ENGINE_DOCKER_SUBSYSTEM_LIMA;
  ENGINE = ENGINE_DOCKER_SUBSYSTEM_LIMA;
  PROGRAM = PROGRAM;

  static create(id, userConfiguration, osType) {
    const instance = new DockerClientEngineSubsystemLIMA(userConfiguration, osType);
    instance.id = `engine.${id}.${instance.ENGINE}`;
    instance.ADAPTER = PROGRAM;
    instance.setup();
    return instance;
  }

  // Settings
  async getExpectedSettings() {
    return {
      api: {
        baseURL: API_BASE_URL,
        connectionString: await this.getConnectionString(LIMA_DOCKER_INSTANCE)
      },
      controller: {
        name: LIMA_PROGRAM,
        path: LIMA_PATH,
        version: LIMA_VERSION,
        scope: LIMA_DOCKER_INSTANCE
      },
      program: {
        name: PROGRAM,
        path: LIMA_DOCKER_CLI_PATH,
        version: LIMA_DOCKER_CLI_VERSION
      }
    };
  }
  // System information
  async getSystemInfo() {
    return super.getSystemInfo("{{ json . }}");
  }
}

class Adapter extends AbstractAdapter {
  static ADAPTER = PROGRAM;
  ADAPTER = PROGRAM;
  ENGINES = [
    DockerClientEngineNative,
    DockerClientEngineVirtualized,
    DockerClientEngineSubsystemWSL,
    DockerClientEngineSubsystemLIMA
  ];

  static create(userConfiguration, osType) {
    const instance = new Adapter(userConfiguration, osType);
    instance.setup();
    return instance;
  }
}

module.exports = {
  // adapters
  Adapter,
  // engines
  DockerClientEngineNative,
  DockerClientEngineVirtualized,
  DockerClientEngineSubsystemWSL,
  DockerClientEngineSubsystemLIMA,
  // constants
  PROGRAM,
  ENGINE_DOCKER_NATIVE,
  ENGINE_DOCKER_VIRTUALIZED,
  ENGINE_DOCKER_SUBSYSTEM_WSL,
  ENGINE_DOCKER_SUBSYSTEM_LIMA
};
