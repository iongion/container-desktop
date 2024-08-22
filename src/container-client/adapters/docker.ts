// nodejs
// vendors
import merge from "lodash.merge";
// project
// module
import { findProgram } from "@/detector";
import { Platform } from "@/platform/node.js";
import { EngineConnectorSettings } from "@/web-app/Types.container-app.js";
import {
  LIMA_PATH,
  // LIMA - common
  LIMA_PROGRAM,
  LIMA_VERSION,
  WSL_DISTRIBUTION,
  WSL_PATH,
  // WSL - common
  WSL_PROGRAM,
  WSL_VERSION
} from "../constants";
import {
  AbstractAdapter,
  AbstractClientEngine,
  AbstractClientEngineSubsystemLIMA,
  // AbstractControlledClientEngine,
  AbstractClientEngineSubsystemWSL
} from "./abstract.js";
// locals
export const PROGRAM = "docker";
const API_BASE_URL = "http://localhost";
const DOCKER_SCOPE_DEFAULT = "docker_engine";
// Native
const NATIVE_DOCKER_CLI_PATH = "/usr/bin/docker";
const NATIVE_DOCKER_CLI_VERSION = "27.1.1";
const NATIVE_DOCKER_SOCKET_PATH = (await Platform.getEnvironmentVariable("DOCKER_HOST")) || `/var/run/${PROGRAM}.sock`;
// Windows virtualized
const WINDOWS_DOCKER_NATIVE_CLI_VERSION = "27.1.1";
const WINDOWS_DOCKER_NATIVE_CLI_PATH = "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe";
const WINDOWS_DOCKER_NATIVE_SOCKET_PATH = `//./pipe/${DOCKER_SCOPE_DEFAULT}`;
// MacOS virtualized
const MACOS_DOCKER_NATIVE_CLI_VERSION = "27.1.1";
const MACOS_DOCKER_NATIVE_CLI_PATH = "/usr/local/bin/docker";
const MACOS_DOCKER_NATIVE_SOCKET_PATH = `/var/run/${PROGRAM}.sock`;
// Windows WSL
const WSL_DOCKER_CLI_PATH = "/usr/bin/docker";
const WSL_DOCKER_CLI_VERSION = "27.1.1";
// MacOS LIMA
const LIMA_DOCKER_CLI_PATH = "/usr/bin/docker";
const LIMA_DOCKER_CLI_VERSION = "27.1.1";
const LIMA_DOCKER_INSTANCE = "docker";
// Engines
export const ENGINE_DOCKER_NATIVE = `${PROGRAM}.native`;
export const ENGINE_DOCKER_VIRTUALIZED = `${PROGRAM}.virtualized`;
export const ENGINE_DOCKER_SUBSYSTEM_WSL = `${PROGRAM}.subsystem.wsl`;
export const ENGINE_DOCKER_SUBSYSTEM_LIMA = `${PROGRAM}.subsystem.lima`;

export class DockerClientEngineNative extends AbstractClientEngine {
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

  getControllerScopes() {
    return [];
  }

  // Settings

  async getExpectedSettings() {
    const envSock = await Platform.getEnvironmentVariable("DOCKER_HOST");
    const program = await findProgram(PROGRAM, { osType: this.osType });
    return {
      api: {
        baseURL: API_BASE_URL,
        connectionString: envSock || NATIVE_DOCKER_SOCKET_PATH
      },
      program: {
        name: PROGRAM,
        path: program?.path || NATIVE_DOCKER_CLI_PATH,
        version: program?.version || NATIVE_DOCKER_CLI_VERSION
      }
    } as EngineConnectorSettings;
  }

  async getUserSettings(): Promise<EngineConnectorSettings> {
    const entry = await this.userConfiguration.getKey<EngineConnectorSettings | undefined>(this.id);
    return {
      api: {
        baseURL: entry?.api?.baseURL,
        connectionString: entry?.api?.connectionString
      },
      program: {
        path: entry?.program?.path,
        name: PROGRAM
      }
    };
  }

  // Runtime
  async startApi(customSettings?: any, opts?: any) {
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

export class DockerClientEngineVirtualized extends DockerClientEngineNative {
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
      const envSock = await Platform.getEnvironmentVariable("DOCKER_HOST");
      settings = {
        api: {
          connectionString: envSock || NATIVE_DOCKER_SOCKET_PATH
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
    const merged: any = merge(
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
    return Promise.resolve(merged);
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

export class DockerClientEngineSubsystemWSL extends AbstractClientEngineSubsystemWSL {
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
    const envSock = await Platform.getEnvironmentVariable("DOCKER_HOST");
    return {
      api: {
        baseURL: API_BASE_URL,
        connectionString: envSock || NATIVE_DOCKER_SOCKET_PATH
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

export class DockerClientEngineSubsystemLIMA extends AbstractClientEngineSubsystemLIMA {
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

export class Adapter extends AbstractAdapter {
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

export default {
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
