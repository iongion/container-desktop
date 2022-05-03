const os = require("os");
const fs = require("fs");
const path = require("path");
// vendors
const merge = require("lodash.merge");
// project
const { createLogger } = require("@podman-desktop-companion/logger");
const { exec_launcher_sync } = require("@podman-desktop-companion/executor");
// module
const { findProgram, findProgramVersion } = require("../detector");
const { createApiDriver, getApiConfig, Runner } = require("../api");
const { getAvailableLIMAInstances, getAvailableWSLDistributions } = require("../shared");
const { WSL_VERSION } = require("../constants");

class AbstractAdapter {
  constructor(userConfiguration, osType) {
    this.userConfiguration = userConfiguration;
    this.osType = osType || os.type();
    this.connectorClientEngineMap = {};
  }
  async getEngines() {
    throw new Error("getEngines must be implemented");
  }
  async getConnectors() {
    throw new Error("getConnectors must be implemented");
  }
  async getEngineClientById(id) {
    await this.getConnectors();
    return this.connectorClientEngineMap[id].client;
  }
}

class AbstractClientEngine {
  PROGRAM = undefined;
  ENGINE = undefined;
  constructor(userConfiguration, osType) {
    this.userConfiguration = userConfiguration;
    this.settings = undefined;
    this.apiDriver = undefined;
    this.logger = createLogger(`${this.PROGRAM}.${this.ENGINE || "Engine"}.client`);
    this.osType = osType || os.type();
    this.runner = new Runner(this);
  }
  // Lazy factory
  async getApiDriver() {
    if (!this.apiDriver) {
      const settings = await this.getCurrentSettings();
      const config = await getApiConfig(settings.api.baseURL, settings.api.connectionString);
      this.apiDriver = await createApiDriver(config);
    }
    return this.apiDriver;
  }
  // Settings
  async getExpectedSettings() {
    throw new Error("getExpectedSettings must be implemented");
  }
  // settings = defaults
  async getUserSettings(settings) {
    return {};
  }
  // settings = merge(defaults, user)
  async getDetectedSettings(settings) {
    throw new Error("getDetectedSettings must be implemented");
  }
  async getSettings() {
    if (!this.settings) {
      const expected = await this.getExpectedSettings();
      const detected = await this.getDetectedSettings(expected);
      const user = await this.getUserSettings(merge({}, expected, detected));
      const settings = {
        expected,
        detected,
        user,
        current: merge({}, expected, user, detected)
      };
      this.settings = settings;
    }
    return this.settings;
  }
  async getCurrentSettings() {
    const settings = await this.getSettings();
    return settings.current;
  }
  ///////
  // Api
  async startApi() {
    throw new Error("startApi must be implemented");
  }
  async stopApi() {
    if (!this.runner) {
      return true;
    }
    return await this.runner.stopApi();
  }
  // Availability
  async isEngineAvailable() {
    throw new Error("isEngineAvailable must be implemented");
  }
  async isProgramAvailable() {
    const result = { success: false, details: undefined };
    const settings = await this.getSettings();
    // Native path to program
    if (!settings.current.program.path) {
      result.details = "Program path is not set";
      return result;
    }
    if (!fs.existsSync(settings.current.program.path)) {
      result.details = "Program is not accessible";
      return result;
    }
    result.success = true;
    result.details = "Program is available";
    return result;
  }
  async isApiAvailable() {
    const result = { success: false, details: undefined };
    const settings = await this.getSettings();
    if (!settings.current.api.baseURL) {
      result.details = "API base URL is not set";
      return result;
    }
    if (!settings.current.api.connectionString) {
      result.details = "API connection string is not set";
      return result;
    }
    // Check unix socket as file
    if (this.osType === "Windows_NT") {
      // TODO: Check named pipe
    } else {
      if (!fs.existsSync(settings.current.api.connectionString)) {
        result.details = `API connection string as unix path is not present in ${settings.current.api.connectionString}`;
        return result;
      }
    }
    result.success = true;
    result.details = "API is configured";
    return result;
  }
  async getAvailability() {
    const availability = {
      all: false,
      engine: false,
      program: false,
      api: false,
      report: {
        engine: "Not checked",
        program: "Not checked",
        api: "Not checked"
      }
    };
    const engine = await this.isEngineAvailable();
    availability.report.engine = engine.details;
    if (engine.success) {
      availability.engine = true;
    }
    if (availability.engine) {
      const program = await this.isProgramAvailable();
      availability.report.program = program.details;
      if (program.success) {
        availability.program = true;
      }
    }
    if (availability.program) {
      const api = await this.isApiRunning();
      availability.report.api = api.details;
      if (api.success) {
        availability.api = true;
      }
    }
    availability.all = availability.engine && availability.program && availability.api;
    return availability;
  }
  async isApiRunning() {
    // Guard configuration
    const available = await this.isApiAvailable();
    if (!available.success) {
      this.logger.debug("API is not available - unable to ping", available);
      return available;
    }
    // Test reachability
    const result = {
      success: false,
      details: undefined
    };
    const driver = await this.getApiDriver();
    try {
      const response = await driver.get("/_ping");
      result.success = response?.data === "OK";
      result.details = response?.data || "Api reached";
    } catch (error) {
      result.details = `API is not accessible - ${error.message}`;
    }
    return result;
  }
}

class AbstractControlledClientEngine extends AbstractClientEngine {
  // Helpers
  async getConnectionString(scope) {
    throw new Error("getConnectionString must be implemented");
  }
  // Settings
  async getExpectedSettings() {
    throw new Error("getExpectedSettings must be implemented");
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
    const controller = settings.controller.path || this.PROGRAM;
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
      info = await findProgram(settings.controller.name || this.PROGRAM);
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
  async isControllerScopeAvailable() {
    throw new Error("isControllerScopeAvailable must be implemented");
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
    const scope = await this.isControllerScopeAvailable();
    if (scope) {
      result.success = true;
      result.details = `Controller scope ${settings.current.controller.scope} is running`;
    } else {
      result.flag = false;
      result.details = `Controller scope ${settings.current.controller.scope} scope is not available`;
      this.logger.error(result.details);
      return result;
    }
    // Only if scope is available
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
    const availability = {
      all: false,
      engine: false,
      controller: false,
      program: false,
      api: false,
      report: {
        engine: "Not checked",
        controller: "Not checked",
        program: "Not checked",
        api: "Not checked"
      }
    };
    const engine = await this.isEngineAvailable();
    availability.report.engine = engine.details;
    if (engine.success) {
      availability.engine = true;
    }
    if (availability.engine) {
      const controller = await this.isControllerAvailable();
      availability.report.controller = controller.details;
      if (controller.success) {
        availability.controller = true;
      }
    }
    if (availability.controller) {
      const program = await this.isProgramAvailable();
      availability.report.program = program.details;
      if (program.success) {
        availability.program = true;
      }
    }
    if (availability.program) {
      const api = await this.isApiRunning();
      availability.report.api = api.details;
      if (api.success) {
        availability.api = true;
      }
    }
    availability.all = availability.engine && availability.controller && availability.program && availability.api;
    return availability;
  }
  // Executes command inside controller scope
  async runScopedCommand(program, args, opts) {
    throw new Error("runScopedCommand must be implemented");
  }
}

class AbstractClientEngineSubsystemWSL extends AbstractControlledClientEngine {
  // Helpers
  async getConnectionString(scope) {
    return `//./pipe/podman-desktop-companion-${this.PROGRAM}-${scope}`;
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
    const result = await exec_launcher_sync(controller.path, command, opts);
    return result;
  }
  // Availability
  async isControllerScopeAvailable() {
    const settings = await this.getCurrentSettings();
    const instances = await getAvailableWSLDistributions(settings.controller.path);
    const target = instances.find((it) => it.Name === settings.controller.scope);
    return !!target;
  }
  async isEngineAvailable() {
    const result = { success: true, details: "Engine is available" };
    if (this.osType !== "Windows_NT") {
      result.success = false;
      result.details = `Engine is not available on ${this.osType}`;
    }
    return result;
  }
}

class AbstractClientEngineSubsystemLIMA extends AbstractControlledClientEngine {
  // Helpers
  async getConnectionString(scope) {
    return path.join(process.env.HOME, ".lima", scope, "sock", `${scope}.sock`);
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
    const result = await exec_launcher_sync(controller.path, command, opts);
    return result;
  }
  // Availability
  async isControllerScopeAvailable() {
    const settings = await this.getCurrentSettings();
    const instances = await getAvailableLIMAInstances(settings.controller.path);
    const target = instances.find((it) => it.Name === settings.controller.scope);
    return target.Status === "Running";
  }
  async isEngineAvailable() {
    const result = { success: true, details: "Engine is available" };
    if (this.osType !== "Darwin") {
      result.success = false;
      result.details = `Engine is not available on ${this.osType}`;
    }
    return result;
  }
}

module.exports = {
  AbstractAdapter,
  AbstractClientEngine,
  AbstractControlledClientEngine,
  AbstractClientEngineSubsystemWSL,
  AbstractClientEngineSubsystemLIMA
};
