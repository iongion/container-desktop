// nodejs
const fs = require("fs");
const path = require("path");
// vendors
const merge = require("lodash.merge");
// project
// module
const { findProgram, findProgramVersion } = require("../detector");
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

class AbstractDockerControlledClientEngine extends AbstractControlledClientEngine {
  PROGRAM = PROGRAM;
}

class DockerClientEngineNative extends AbstractClientEngine {
  ENGINE = ENGINE_DOCKER_NATIVE;
  PROGRAM = PROGRAM;
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
  async getDetectedSettings(settings) {
    let info = {};
    if (fs.existsSync(settings.program.path)) {
      const detectVersion = await findProgramVersion(settings.program.path || PROGRAM);
      info.program = {
        version: detectVersion
      };
    } else {
      info = await findProgram(settings.program.name || PROGRAM);
    }
    return info;
  }
  // Runtime
  async startApi() {
    this.logger.debug("Start api skipped - not required");
    return true;
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

class DockerClientEngineVirtualized extends DockerClientEngineNative {
  ENGINE = ENGINE_DOCKER_VIRTUALIZED;
  // Settings
  async getExpectedSettings() {
    let settings = {};
    if (this.osType === "Linux") {
      settings = {
        api: {
          connectionString: NATIVE_DOCKER_SOCKET_PATH
        },
        program: {
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
  ENGINE = ENGINE_DOCKER_SUBSYSTEM_WSL;
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
        path: WSL_DOCKER_CLI_PATH,
        version: WSL_DOCKER_CLI_VERSION
      }
    };
  }
}

class DockerClientEngineSubsystemLIMA extends AbstractClientEngineSubsystemLIMA {
  ENGINE = ENGINE_DOCKER_SUBSYSTEM_LIMA;
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
        scope: LIMA_DOCKER_INSTANCE
      },
      program: {
        name: PROGRAM,
        path: LIMA_DOCKER_CLI_PATH,
        version: LIMA_DOCKER_CLI_VERSION
      }
    };
  }
}

class DockerAdapter extends AbstractAdapter {
  constructor(userConfiguration, osType) {
    super(userConfiguration, osType);
    this.connectorClientEngineMap = {};
  }
  async getEngines() {
    return [
      DockerClientEngineNative,
      DockerClientEngineVirtualized,
      DockerClientEngineSubsystemWSL,
      DockerClientEngineSubsystemLIMA
    ].map((DockerClientEngine) => {
      const engine = new DockerClientEngine(this.userConfiguration, this.osType);
      return engine;
    });
  }
  async getConnectors() {
    const engines = await this.getEngines();
    const connectors = await Promise.all(
      engines.map(async (client) => {
        const id = `engine.default.${client.ENGINE}`;
        if (!this.connectorClientEngineMap[id]) {
          const settings = await client.getSettings();
          const connector = {
            id,
            engine: client.ENGINE,
            availability: await client.getAvailability(),
            settings
          };
          this.connectorClientEngineMap[id] = {
            client,
            connector
          };
        }
        return this.connectorClientEngineMap[id].connector;
      })
    );
    return connectors;
  }
  async getEngineClientById(id) {
    await this.getConnectors();
    return this.connectorClientEngineMap[id].client;
  }
}

module.exports = {
  // adapters
  DockerAdapter,
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
