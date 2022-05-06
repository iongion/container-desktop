const os = require("os");
const fs = require("fs");
const path = require("path");
// vendors
const merge = require("lodash.merge");
// project
const { createLogger } = require("@podman-desktop-companion/logger");
const { exec_launcher_sync } = require("@podman-desktop-companion/executor");
// module
const { findProgramVersion } = require("../detector");
const { createApiDriver, getApiConfig, Runner } = require("../api");
const { getAvailableLIMAInstances, getAvailableWSLDistributions } = require("../shared");
const { WSL_VERSION } = require("../constants");

/**
 *
 * @typedef {Object} Api
 * @property {string} baseURL - The HTTP API base url
 * @property {number} connectionString - The HTTP API connection string as unix socket or windows named pipe
 *
 * @typedef {Object} Program
 * @property {string} name - The name of the program
 * @property {version} path - The executable path of the program
 * @property {string} version - The program version
 *
 * @typedef {Object} Controller
 * @property {string} name - The name of the program
 * @property {version} path - The executable path of the program
 * @property {string} version - The program version
 *
 * @typedef {Object} Settings
 * @property {Api} api
 * @property {Program} program
 *
 * @typedef {Object} SettingsDictionary
 * @property {Settings} expected - suggested
 * @property {Settings} detected - computed
 * @property {Settings} automatic - merging of suggested and computed
 * @property {Settings} user - user overrides
 * @property {Settings} current - merging of expected, detected, automatic and user
 *
 */

class AbstractAdapter {
  /** @access public */
  ADAPTER = undefined;
  constructor(userConfiguration, osType) {
    /** @access protected */
    this.userConfiguration = userConfiguration;
    /** @access protected */
    this.osType = osType || os.type();
  }
}

class AbstractClientEngine {
  /** @access public */
  PROGRAM = undefined;
  /** @access public */
  ADAPTER = undefined;
  /** @access public */
  ENGINE = undefined;

  constructor(userConfiguration, osType) {
    /** @access protected */
    this.userConfiguration = userConfiguration;
    /** @access protected */
    this.osType = osType || os.type();
    /** @access protected */
    this.logger = createLogger(`${this.PROGRAM}.${this.ENGINE || "Engine"}.client`);
    /** @access private */
    this.runner = new Runner(this);
  }

  // Lazy factory
  async getApiDriver() {
    const settings = await this.getCurrentSettings();
    const config = await getApiConfig(settings.api.baseURL, settings.api.connectionString);
    const apiDriver = await createApiDriver(config);
    return apiDriver;
  }

  /**
   * Creates a predefined dictionary with suggested optimal configuration
   * @abstract
   * @protected
   * @return {Settings}
   */
  async getExpectedSettings() {
    throw new Error("getExpectedSettings must be implemented");
  }

  /**
   * Creates a dictionary with configuration resulting from probing the system
   * @abstract
   * @protected
   * @return {Settings}
   */
  async getDetectedSettings(settings) {
    throw new Error("getDetectedSettings must be implemented");
  }

  /**
   * Creates a dictionary with merged configuration resulting from merging expected and detected settings
   * @protected
   * @return {Settings}
   */
  async getAutomaticSettings() {
    const expected = await this.getExpectedSettings();
    const detected = await this.getDetectedSettings(expected);
    return merge({}, expected, detected);
  }

  /**
   * Creates a dictionary with configuration resulting from user defined overrides.
   * Optimize and avoid calling it if the engine is not accessible
   *
   * @public
   * @return {Settings}
   */
  async getUserSettings() {
    return {
      api: {
        baseURL: undefined,
        connectionString: undefined
      },
      program: {
        path: undefined
      }
    };
  }

  /**
   * Persists a dictionary with configuration resulting from user defined overrides.
   *
   * @param {Settings} settings
   *        The user settings
   * @public
   * @abstract
   * @return {Settings}
   */
  async setUserSettings(settings) {
    const defaults = await this.getUserSettings();
    const userSettings = this.userConfiguration.getKey(this.id);
    const updated = merge(defaults, userSettings, settings || {});
    this.userConfiguration.setKey(this.id, updated);
    return updated;
  }

  /**
   * Creates a dictionary with all configurations and an additional current key made of merging of expected > detected > automatic > user
   * @public
   * @return {SettingsDictionary}
   */
  async getSettings() {
    const expected = await this.getExpectedSettings();
    const detected = await this.getDetectedSettings(expected);
    const automatic = await this.getAutomaticSettings();
    // Optimization - apply user overrides only if engine is available
    let user = {};
    const available = await this.isEngineAvailable();
    if (available) {
      user = await this.getUserSettings();
    }
    const settings = {
      expected,
      detected,
      automatic,
      user,
      current: merge(
        {
          api: {
            baseURL: undefined,
            connectionString: undefined
          },
          program: {
            name: this.PROGRAM,
            path: undefined,
            version: undefined
          }
        },
        automatic,
        user
      )
    };
    return settings;
  }

  /**
   * Extracts only the current settings representing actual configuration
   * @public
   * @return {Settings} Settings - Actual settings
   */
  async getCurrentSettings() {
    if (!this.currentSettings) {
      const settings = await this.getSettings();
      this.currentSettings = settings.current;
    }
    return this.currentSettings;
  }

  /**
   *
   * Attempts to put the system in a proper state for communication
   * @abstract
   * @public
   * @return {bool} flag representing success or failure during startup
   */
  async startApi() {
    throw new Error("startApi must be implemented");
  }

  /**
   *
   * Cleans-up start processes and allocated resources
   * @public
   * @return {bool} flag representing success or failure during cleanup
   */
  async stopApi() {
    if (!this.runner) {
      return true;
    }
    return await this.runner.stopApi();
  }

  /**
   *
   * Platform / Operating system based availability check for current engine.
   * This method must not access settings as it is called during their computation!
   * @abstract
   * @public
   * @return {bool} flag representing accessibility
   */
  async isEngineAvailable() {
    throw new Error("isEngineAvailable must be implemented");
  }

  /**
   *
   * Verifies if the program is specified and can be executable
   * @public
   * @return {bool} flag representing availability
   */
  async isProgramAvailable() {
    const result = { success: false, details: undefined };
    const settings = await this.getCurrentSettings();
    // Native path to program
    if (!settings.program.path) {
      result.details = "Program path is not set";
      return result;
    }
    if (!fs.existsSync(settings.program.path)) {
      result.details = "Program is not accessible";
      return result;
    }
    result.success = true;
    result.details = "Program is available";
    return result;
  }

  /**
   *
   * Verifies if the api is specified and can be queried
   * @public
   * @return {bool} flag representing availability
   */
  async isApiAvailable() {
    const result = { success: false, details: undefined };
    const settings = await this.getCurrentSettings();
    if (!settings.api.baseURL) {
      result.details = "API base URL is not set";
      return result;
    }
    if (!settings.api.connectionString) {
      result.details = "API connection string is not set";
      return result;
    }
    // Check unix socket as file
    if (this.osType === "Windows_NT") {
      // TODO: Check named pipe
    } else {
      if (!fs.existsSync(settings.api.connectionString)) {
        result.details = "API connection string as unix path is not present";
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
      result.details = "API is not accessible";
      this.logger.error("API ping service failed");
    }
    return result;
  }
  async getConnector() {
    const connector = {
      id: this.id,
      adapter: this.ADAPTER, // injected by factory
      engine: this.ENGINE,
      availability: await this.getAvailability(),
      settings: await this.getSettings()
    };
    return connector;
  }
  // Executes command inside controller scope
  async runScopedCommand(program, args, opts) {
    const result = await exec_launcher_sync(program, args, opts);
    return result;
  }

  // Services

  async getSystemInfo(customFormat) {
    let info = {};
    const { program } = await this.getCurrentSettings();
    const result = await this.runScopedCommand(program.path, ["system", "info", "--format", customFormat || "json"]);
    if (!result.success) {
      this.logger.error("Unable to get system info", result);
      return info;
    }
    try {
      info = result.stdout ? JSON.parse(result.stdout) : info;
    } catch (error) {
      this.logger.error("Unable to decode system info", error, result);
    }
    return info;
  }

  async getMachines() {
    return [];
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
    }
    return info;
  }

  async getSettings() {
    const expected = await this.getExpectedSettings();
    const detected = await this.getDetectedSettings(expected);
    const automatic = await this.getAutomaticSettings();
    // Optimization - apply user overrides only if engine is available
    let user = {};
    const available = await this.isEngineAvailable();
    if (available) {
      user = await this.getUserSettings();
    }
    const settings = {
      expected,
      detected,
      automatic,
      user,
      current: merge(
        {
          api: {
            baseURL: undefined,
            connectionString: undefined
          },
          controller: {
            path: undefined,
            scope: undefined,
            version: undefined
          },
          program: {
            name: this.PROGRAM,
            path: undefined,
            version: undefined
          }
        },
        automatic,
        user
      )
    };
    settings.current.api.connectionString = await this.getConnectionString(settings.current.controller.scope);
    return settings;
  }

  // Availability
  async isControllerAvailable() {
    const settings = await this.getCurrentSettings();
    let success = false;
    let details;
    if (settings.controller.path) {
      if (fs.existsSync(settings.controller.path)) {
        success = true;
        details = "Controller is available";
      } else {
        details = `Controller not found in expected ${settings.controller.path} location`;
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
    const settings = await this.getCurrentSettings();
    const scope = await this.isControllerScopeAvailable();
    if (scope) {
      result.success = true;
      result.details = `Controller scope ${settings.controller.scope} is running`;
    } else {
      result.flag = false;
      result.details = `Controller scope ${settings.controller.scope} is not available`;
      return result;
    }
    // Only if scope is available
    if (!settings.program.path) {
      result.details = "Program path is not set";
    }
    // Controlled path to program
    const check = await this.runScopedCommand("test", ["-f", settings.program.path]);
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
  async getControllerScopes() {
    throw new Error("getControllerScopes must be implemented");
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
  // Services
  async getControllerScopes() {
    const settings = await this.getCurrentSettings();
    const items = await getAvailableWSLDistributions(settings.controller.path);
    return items;
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
  // Services
  async getControllerScopes() {
    const settings = await this.getCurrentSettings();
    const items = await getAvailableLIMAInstances(settings.controller.path);
    return items;
  }
}

module.exports = {
  AbstractAdapter,
  AbstractClientEngine,
  AbstractControlledClientEngine,
  AbstractClientEngineSubsystemWSL,
  AbstractClientEngineSubsystemLIMA
};
