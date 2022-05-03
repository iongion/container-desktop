// nodejs
const fs = require("fs");
const path = require("path");
// vendors
const merge = require("lodash.merge");
// project
const { exec_launcher, exec_launcher_sync } = require("@podman-desktop-companion/executor");
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
const { AbstractAdapter, AbstractClientEngine } = require("./abstract");
// locals
const PROGRAM = "podman";
const API_BASE_URL = "http://d/v3.0.0/libpod";
const PODMAN_MACHINE_DEFAULT = "podman-machine-default";
// Native
const NATIVE_PODMAN_CLI_PATH = "/usr/bin/podman";
const NATIVE_PODMAN_CLI_VERSION = "4.0.3";
const NATIVE_PODMAN_SOCKET_PATH = `/tmp/podman-desktop-companion-${PROGRAM}-rest-api.sock`;
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

class PodmanClientEngineNative extends AbstractClientEngine {
  ENGINE = ENGINE_PODMAN_NATIVE;
  constructor(userConfiguration, osType) {
    super(userConfiguration, osType, PROGRAM);
  }
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
}

class PodmanClientEngineControlled extends AbstractClientEngine {
  constructor(userConfiguration, osType) {
    super(userConfiguration, osType, PROGRAM);
  }
  // Helpers
  async getConnectionString(scope) {
    throw new Error("getConnectionString must be implemented");
  }
  // Settings
  async getExpectedSettings() {
    return {
      api: {
        baseURL: API_BASE_URL,
        connectionString: NATIVE_PODMAN_SOCKET_PATH
      },
      controller: {
        path: "",
        version: "",
        scope: PODMAN_MACHINE_DEFAULT
      },
      program: {
        path: "",
        version: ""
      }
    };
  }
  async getUserSettings() {
    return {
      api: {
        baseURL: this.userConfiguration.getKey(`${this.id}.api.baseURL`),
        connectionString: this.userConfiguration.getKey(`${this.id}.api.connectionString`)
      },
      controller: {
        path: this.userConfiguration.getKey(`${this.id}.controller.path`),
        scope: this.userConfiguration.getKey(`${this.id}.controller.scope`)
      },
      program: {
        path: this.userConfiguration.getKey(`${this.id}.program.path`)
      }
    };
  }
  async getDetectedSettings(settings) {
    const controller = settings.controller.path || PROGRAM;
    let info = {};
    // controller
    if (fs.existsSync(settings.controller.path)) {
      const detectVersion = await findProgramVersion(
        controller,
        this.osType === "Windows_NT" ? WSL_VERSION : undefined
      );
      info.controller = {
        version: detectVersion
      };
    } else {
      info = await findProgram(settings.controller.name || PROGRAM);
    }
    return info;
  }
  async getSettings() {
    const settings = await super.getSettings();
    settings.current.api.connectionString = await this.getConnectionString(settings.current.controller.scope);
    return settings;
  }
  // Availability
  async isControllerAvailable() {
    const settings = await this.getSettings();
    let success = false;
    let details;
    if (settings.current.controller.path) {
      if (fs.existsSync(settings.current.controller.path)) {
        success = true;
        details = "Controller is available";
      } else {
        details = `Controller not found in expected ${settings.current.controller.path} location`;
      }
    } else {
      details = "Controller path not set";
    }
    return { success, details };
  }
  async isProgramAvailable() {
    // Controller must be proper
    const controller = await this.isControllerAvailable();
    if (!controller.success) {
      return controller;
    }
    // Perform actual program check
    const result = { success: false, details: undefined };
    const settings = await this.getSettings();
    if (!settings.current.program.path) {
      result.details = "Program path is not set";
    }
    // Controlled path to program
    const check = await this.runScopedCommand("test", ["-f", settings.current.program.path]);
    if (check.success) {
      result.success = true;
      result.details = "Program is available";
    } else {
      result.details = check.stderr;
    }
    return result;
  }
  async getAvailability() {
    const base = await super.getAvailability();
    const controller = await this.isControllerAvailable();
    return {
      ...base,
      all: base.all && base.success,
      controller: controller.success,
      report: {
        ...base.report,
        controller: controller.success ? "Controller is running" : controller.details
      }
    };
  }
  // Executes command inside controller scope
  async runScopedCommand(program, args, opts) {
    throw new Error("runScopedCommand must be implemented");
  }
}

class PodmanClientEngineVirtualized extends PodmanClientEngineControlled {
  ENGINE = ENGINE_PODMAN_VIRTUALIZED;
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
    const defaults = await super.getExpectedSettings();
    const connectionString = await this.getConnectionString(PODMAN_MACHINE_DEFAULT);
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
  async isControllerAvailable() {
    const settings = await this.getSettings();
    let flag = settings.current.controller.path.length > 0 && fs.existsSync(settings.current.controller.path);
    let details;
    if (flag) {
      const machines = await this.getMachines();
      const target = machines.find((it) => it.Name === settings.current.controller.scope && it.Running);
      if (target) {
        flag = true;
        details = `${settings.current.controller.scope} is running`;
      } else {
        flag = false;
        details = `Controller ${settings.current.controller.scope} is not running`;
        this.logger.error("Controller is not available - no running machine found");
      }
    }
    return { success: flag, details };
  }
  // Podman machines
  async getMachines(customFormat) {
    let items = [];
    const { controller } = await this.getCurrentSettings();
    const command = ["machine", "list", "--format", customFormat || "json"];
    const result = await exec_launcher_sync(controller.path, command);
    if (!result.success) {
      this.logger.error("Unable to get machines list", result);
      return items;
    }
    try {
      items = result.stdout ? JSON.parse(result.stdout) : items;
    } catch (error) {
      this.logger.error("Unable to decode machines list", error, result);
    }
    return items;
  }

  // Executes command inside controller scope
  async runScopedCommand(program, args, opts) {
    const { controller } = await this.getCurrentSettings();
    const command = ["machine", "ssh", controller.scope, "-o", "LogLevel=ERROR", program, ...args];
    const result = await exec_launcher_sync(controller.path, command, opts);
    return result;
  }
}

class PodmanClientEngineSubsystemWSL extends PodmanClientEngineControlled {
  ENGINE = ENGINE_PODMAN_SUBSYSTEM_WSL;
  // Helpers
  async getConnectionString(scope) {
    return `//./pipe/podman-desktop-companion-${PROGRAM}-${scope}`;
  }
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
  // Runtime
  async startApi() {
    this.logger.debug("Start api skipped - not required");
    return true;
  }
  async stopApi() {
    this.logger.debug("Stop api skipped - not required");
    return true;
  }
  // Executes command inside controller scope
  async runScopedCommand(program, args, opts) {
    const { controller } = await this.getCurrentSettings();
    const command = ["--distribution", controller.scope, program, ...args];
    const result = await exec_launcher(controller.path, command, opts);
    return result;
  }
}

class PodmanClientEngineSubsystemLIMA extends PodmanClientEngineControlled {
  ENGINE = ENGINE_PODMAN_SUBSYSTEM_LIMA;
  // Helpers
  async getConnectionString(scope) {
    return path.join(process.env.HOME, ".lima", scope, "sock/podman.sock");
  }
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
      args: ["start", settings.controller.scope]
    });
  }
  async stopApi(opts) {
    const settings = await this.getCurrentSettings();
    return await this.runner.stopApi(opts, {
      path: settings.controller.path,
      args: ["stop", settings.controller.scope]
    });
  }
  // Executes command inside controller scope
  async runScopedCommand(program, args, opts) {
    const { controller } = await this.getCurrentSettings();
    const command = ["shell", controller.scope, program, ...args];
    const result = await exec_launcher(controller.path, command, opts);
    return result;
  }
}

class PodmanAdapter extends AbstractAdapter {
  constructor(userConfiguration, osType) {
    super(userConfiguration, osType);
    this.connectorClientEngineMap = {};
  }
  async getEngines() {
    return [
      PodmanClientEngineNative,
      PodmanClientEngineVirtualized,
      PodmanClientEngineSubsystemWSL,
      PodmanClientEngineSubsystemLIMA
    ].map((PodmanClientEngine) => {
      const engine = new PodmanClientEngine(this.userConfiguration, this.osType);
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
  PodmanAdapter,
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
