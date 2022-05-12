const net = require("net");
const os = require("os");
const path = require("path");
// vendors
const merge = require("lodash.merge");
const { v4 } = require("uuid");
// project
const { createLogger } = require("@podman-desktop-companion/logger");
const { isFilePresent, exec_launcher_async, exec_launcher_sync } = require("@podman-desktop-companion/executor");
// module
const { createApiDriver, getApiConfig, Runner } = require("../api");
const { getAvailableLIMAInstances, getAvailableWSLDistributions } = require("../shared");
const { findProgram } = require("../detector");
const { LIMA_PROGRAM, WSL_PROGRAM } = require("../constants");

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
 * @property {Settings} user - user overrides
 * @property {Settings} current - merging of expected and user
 *
 */

class AbstractAdapter {
  /** @access public */
  ADAPTER = undefined;
  /** @access public */
  ENGINES = [];

  constructor(userConfiguration, osType) {
    /** @access protected */
    this.userConfiguration = userConfiguration;
    /** @access protected */
    this.osType = osType || os.type();
    this.logger = createLogger(`${this.ADAPTER}.adapter`);
  }

  createEngines() {
    return this.ENGINES.map((Engine) => this.createEngine(Engine));
  }

  createEngine(Engine) {
    const instance = new Engine(this.userConfiguration, this.osType);
    instance.ADAPTER = this.ADAPTER;
    instance.id = `engine.default.${instance.ENGINE}`;
    return instance;
  }

  createEngineByName(engine) {
    const Engine = this.ENGINES.find((it) => it.ENGINE === engine);
    if (!Engine) {
      this.logger.error(
        "Unable to find specified engine",
        engine,
        this.ENGINES.map((it) => it.ENGINE)
      );
      throw new Error("Unable to find specified engine");
    }
    return this.createEngine(Engine);
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
   * Creates a dictionary with all configurations and an additional current key made of merging of expected > user
   * @public
   * @return {SettingsDictionary}
   */
  async getSettings() {
    const expected = await this.getExpectedSettings();
    // Optimization - apply user overrides only if engine is available
    let user = {};
    const available = await this.isEngineAvailable();
    if (available.success) {
      user = await this.getUserSettings();
    }
    const settings = {
      expected,
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
  async isProgramAvailable(settings) {
    const result = { success: false, details: undefined };
    // Native path to program
    if (!settings.program.path) {
      result.details = "Program path is not set";
      return result;
    }
    // if (!isFilePresent(settings.program.path)) {
    //   result.details = "Program is not accessible";
    //   return result;
    // }
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
      // if (!isFilePresent(settings.api.connectionString)) {
      //   result.details = "API connection string as unix path is not present";
      //   return result;
      // }
    }
    result.success = true;
    result.details = "API is configured";
    return result;
  }

  async getAvailability(settings) {
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
      const program = await this.isProgramAvailable(settings);
      availability.report.program = program.details;
      if (program.success) {
        availability.program = true;
      }
    } else {
      availability.report.program = "Not checked - engine not available";
    }
    if (availability.program) {
      const api = await this.isApiRunning();
      availability.report.api = api.details;
      if (api.success) {
        availability.api = true;
      }
    } else {
      availability.report.api = "Not checked - program not available";
    }
    availability.all = availability.engine && availability.program && availability.api;
    return availability;
  }
  async isApiRunning() {
    // Guard configuration
    const available = await this.isApiAvailable();
    if (!available.success) {
      this.logger.debug(this.ADAPTER, this.ENGINE, "API is not available - unable to ping", available);
      return available;
    }
    // Test reachability
    const result = {
      success: false,
      details: undefined
    };
    const driver = await this.getApiDriver();
    try {
      const response = await driver.request({ method: "GET", url: "/_ping" });
      result.success = response?.data === "OK";
      result.details = result.success ? "Api is reachable" : response?.data;
    } catch (error) {
      result.details = "API is not reachable - start manually or connect";
      this.logger.error(
        this.ADAPTER,
        this.ENGINE,
        "API ping service failed",
        error.message,
        error.response ? { code: error.response.status, statusText: error.response.statusText } : ""
      );
    }
    return result;
  }
  async getConnector(opts) {
    const connector = {
      id: this.id,
      adapter: this.ADAPTER, // injected by factory
      engine: this.ENGINE,
      settings: await this.getSettings(opts)
    };
    try {
      const current = await this.getCurrentSettings(opts);
      connector.settings.current = merge(
        {},
        connector.settings.expected,
        connector.settings.user,
        connector.settings.current,
        current
      );
    } catch (error) {
      this.logger.error("Unable to inject current settings", error.message, error.stack);
    }
    // IMPORTANT - compute availability only after computing current settings
    connector.availability = await this.getAvailability(connector.settings.current);
    return connector;
  }
  // Executes command inside controller scope
  async getScopedCommand(program, args, opts) {
    // pass-through
    return { launcher: program, command: args };
  }

  async runScopedCommand(program, args, opts) {
    const { launcher, command } = await this.getScopedCommand(program, args, opts);
    let result;
    if (opts?.async) {
      result = await exec_launcher_async(launcher, command, opts);
    } else {
      result = await exec_launcher_sync(launcher, command, opts);
    }
    return result;
  }

  // Services

  async getSystemInfo(customFormat) {
    let info = {};
    const { program } = await this.getCurrentSettings();
    const result = await this.runScopedCommand(program.path, ["system", "info", "--format", customFormat || "json"]);
    if (!result.success) {
      this.logger.error(this.ADAPTER, this.ENGINE, "Unable to get system info", result);
      return info;
    }
    try {
      info = result.stdout ? JSON.parse(result.stdout) : info;
    } catch (error) {
      this.logger.error(this.ADAPTER, this.ENGINE, "Unable to decode system info", error, result);
    }
    return info;
  }

  async getControllerScopes() {
    return [];
  }

  // Clean-up
  async pruneSystem(opts) {
    const input = {
      all: true,
      filter: {},
      force: true,
      volumes: false,
      ...(opts || {})
    };
    const args = ["system", "prune"];
    if (input.all) {
      args.push("--all");
    }
    if (input.filter) {
      args.push(...Object.keys(input.filter).map((key) => `label=${key}=${filter[key]}`));
    }
    if (input.force) {
      args.push("--force");
    }
    if (input.volumes) {
      args.push("--volumes");
    }
    const { program } = await this.getCurrentSettings();
    const result = await this.runScopedCommand(program.path, args);
    if (result.success) {
      this.logger.debug(this.ADAPTER, this.ENGINE, "System prune complete");
    } else {
      this.logger.error(this.ADAPTER, this.ENGINE, "System prune error", result);
    }
    return result.success;
  }

  async resetSystem() {
    if (this.PROGRAM === "docker") {
      this.logger.debug(this.ADAPTER, this.ENGINE, "No such concept for current engine - skipping");
      return true;
    }
    const { program } = await this.getCurrentSettings();
    const args = ["system", "reset", "--force", "--log-level=debug"];
    const result = await this.runScopedCommand(program.path, args);
    if (result.success) {
      logger.debug(this.ADAPTER, this.ENGINE, "System reset success", result);
    } else {
      logger.error(this.ADAPTER, this.ENGINE, "System reset error", result);
    }
    return result.success;
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

  async getSettings() {
    const expected = await this.getExpectedSettings();
    // Optimization - apply user overrides only if engine is available
    let user = {};
    const available = await this.isEngineAvailable();
    if (available.success) {
      user = await this.getUserSettings();
    }
    const settings = {
      expected,
      user,
      current: merge(
        {
          api: {
            baseURL: undefined,
            connectionString: undefined
          },
          controller: {
            name: expected?.controller?.name,
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
        user
      )
    };
    return settings;
  }

  // Availability
  async isControllerAvailable(settings) {
    let success = false;
    let details;
    if (settings?.controller?.path) {
      success = true;
      // if (isFilePresent(settings.controller.path)) {
      //   success = true;
      //   details = "Controller is available";
      // } else {
      //   details = `Controller not found`;
      // }
    } else {
      details = "Controller path not set";
    }
    return { success, details };
  }
  async isControllerScopeAvailable(settings) {
    throw new Error("isControllerScopeAvailable must be implemented");
  }
  async isProgramAvailable(settings) {
    // Controller must be proper
    const controller = await this.isControllerAvailable(settings);
    if (!controller.success) {
      return controller;
    }
    // Perform actual program check
    const result = { success: false, details: undefined };
    const scope = await this.isControllerScopeAvailable(settings);
    if (scope) {
      result.success = true;
      result.details = `Controller scope ${settings.controller.scope} is running`;
    } else {
      result.flag = false;
      if (settings.controller.scope) {
        result.details = `Controller scope ${settings.controller.scope} is not available`;
      } else {
        result.details = `Controller scope is not set`;
      }
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
  async getAvailability(settings) {
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
      const controller = await this.isControllerAvailable(settings);
      availability.report.controller = controller.details;
      if (controller.success) {
        availability.controller = true;
      }
    } else {
      availability.report.controller = "Not checked - engine not available";
    }
    if (availability.controller) {
      const program = await this.isProgramAvailable(settings);
      availability.report.program = program.details;
      if (program.success) {
        availability.program = true;
      }
    } else {
      availability.report.program = "Not checked - controller not available";
    }
    if (availability.program) {
      const api = await this.isApiRunning();
      availability.report.api = api.details;
      if (api.success) {
        availability.api = true;
      }
    } else {
      availability.report.api = `Not checked - ${availability.report.program}`;
    }
    availability.all = availability.engine && availability.controller && availability.program && availability.api;
    return availability;
  }
  async getConnector(opts) {
    const connector = await super.getConnector(opts);
    connector.scopes = await this.getControllerScopes();
    return connector;
  }
  // Executes command inside controller scope
  async getScopedCommand(program, args, opts) {
    throw new Error("getScopedCommand must be implemented");
  }
  async getControllerScopes() {
    throw new Error("getControllerScopes must be implemented");
  }
}

class AbstractClientEngineSubsystemWSL extends AbstractControlledClientEngine {
  async createApiDriver(config) {
    return {
      request: async (request) => {
        const response = await new Promise((resolve, reject) => {
          // Create Windows Named Pipe server
          const PIPE_NAME = `request-guid-${v4()}`;
          const PIPE_PATH = "\\\\.\\pipe\\" + PIPE_NAME;
          let response;
          let lastError;
          let complete = false;
          const server = net.createServer((stream) => {
            stream.on("data", async (c) => {
              const data = c.toString();
              if (complete) {
                this.logger.debug("Relaying already handled", data);
                return;
              }
              complete = true;
              this.logger.debug("Relaying request to native unix socket", config.socketPath, data);
              if (data) {
                try {
                  const result = await this.runScopedCommand("printf", [
                    data,
                    "|",
                    "socat",
                    `UNIX-CONNECT:${config.socketPath}`,
                    "-"
                  ]);
                  this.logger.debug("Relaying response back to named pipe", result);
                  const output = result.success ? result.stdout : result.stderr;
                  stream.write(output);
                } catch (error) {
                  this.logger.error(this.ENGINE, "Native communication error", error);
                } finally {
                  stream.end();
                }
              }
            });
            stream.on("end", () => {
              server.close();
              if (lastError) {
                reject(lastError);
              } else {
                resolve(response);
              }
            });
          });
          server.listen(PIPE_PATH, async () => {
            // Make actual request to the temporary socket server created above
            this.logger.debug("Issuing request to windows named pipe server", PIPE_PATH);
            const actual = { ...config, socketPath: PIPE_PATH };
            const driver = createApiDriver(actual);
            try {
              response = await driver.request(request);
              this.logger.debug("Response received", response.status, response.data);
            } catch (error) {
              lastError = error;
              this.logger.error(this.ENGINE, "Request invocation error", error.message, error.response?.status);
            }
          });
        });
        return response;
      }
    };
  }

  async getApiDriver(userConfig) {
    const settings = await this.getCurrentSettings();
    const config = userConfig || (await getApiConfig(settings.api.baseURL, settings.api.connectionString));
    const apiDriver = await this.createApiDriver(config);
    return apiDriver;
  }

  // Helpers
  async getConnectionString(scope) {
    return undefined;
  }
  // Runtime
  async startApi() {
    this.logger.debug(this.ADAPTER, this.ENGINE, "Start api skipped - not required");
    return true;
  }
  async stopApi() {
    this.logger.debug(this.ADAPTER, this.ENGINE, "Stop api skipped - not required");
    return true;
  }
  // Availability
  async isControllerScopeAvailable(settings) {
    if (settings?.controller?.scope) {
      const instances = await this.getControllerScopes();
      const target = instances.find((it) => it.Name === settings.controller.scope);
      return !!target;
    }
    return false;
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
    const available = await this.isEngineAvailable();
    const items = available ? await getAvailableWSLDistributions(settings.controller.path) : [];
    return items;
  }
  // Executes command inside controller scope
  async getScopedCommand(program, args, opts) {
    const { controller } = await this.getCurrentSettings();
    const command = ["--distribution", opts?.scope || controller.scope, program, ...args];
    return { launcher: controller.path, command };
  }
  async getCurrentSettings() {
    const settings = await super.getCurrentSettings();
    if (this.osType === "Windows_NT") {
      if (this._detectedControllerProgram) {
        this.logger.debug(this.id, "DETECT WSL PROGRAM CONTROLLER CACHE HIT", this._detectedControllerProgram);
      } else {
        this.logger.warn(this.id, "DETECT WSL PROGRAM CONTROLLER CACHE MISS");
        try {
          this._detectedControllerProgram = await findProgram(WSL_PROGRAM, { osType: this.osType });
        } catch (error) {
          this.logger.error("Unable to find WSL", error.message, error.stack);
        }
        settings.controller.name = WSL_PROGRAM;
        settings.controller.path = this._detectedControllerProgram?.path;
        this.currentSettings = settings;
      }
      settings.controller.version = this._detectedControllerProgram?.version;
    } else {
      this.logger.debug("WSL program detection skipped on", this.osType);
    }
    return settings;
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
      this.logger.debug(this.ADAPTER, this.ENGINE, "API is already running");
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
  // Availability
  async isControllerScopeAvailable(settings) {
    if (settings?.controller?.scope) {
      const instances = await this.getControllerScopes();
      const target = instances.find((it) => it.Name === settings.controller.scope);
      return target?.Status === "Running";
    }
    return false;
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
    const available = await this.isEngineAvailable();
    const canListScopes = available && settings.controller.path;
    const items = canListScopes ? await getAvailableLIMAInstances(settings.controller.path) : [];
    return items;
  }
  // Executes command inside controller scope
  async getScopedCommand(program, args, opts) {
    const { controller } = await this.getCurrentSettings();
    const command = ["shell", opts?.scope || controller.scope, program, ...args];
    return { launcher: controller.path, command };
  }
  async getCurrentSettings() {
    const settings = await super.getCurrentSettings();
    if (this.osType === "Darwin") {
      if (this._detectedControllerProgram) {
        this.logger.debug(this.id, "DETECT PROGRAM CONTROLLER CACHE HIT", this._detectedControllerProgram);
      } else {
        this.logger.warn(this.id, "DETECT PROGRAM CONTROLLER CACHE MISS");
        try {
          this._detectedControllerProgram = await findProgram(LIMA_PROGRAM, { osType: this.osType });
        } catch (error) {
          this.logger.error("Unable to find LIMA", error.message, error.stack);
        }
        settings.controller.name = LIMA_PROGRAM;
        settings.controller.path = this._detectedControllerProgram?.path;
        this.currentSettings = settings;
      }
      settings.controller.version = this._detectedControllerProgram?.version;
    } else {
      this.logger.debug("LIMA program detection skipped on", this.osType);
    }
    return settings;
  }
}

module.exports = {
  AbstractAdapter,
  AbstractClientEngine,
  AbstractControlledClientEngine,
  AbstractClientEngineSubsystemWSL,
  AbstractClientEngineSubsystemLIMA
};
