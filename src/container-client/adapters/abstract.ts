import net from "node:net";
// vendors
import merge from "lodash.merge";
import { v4 } from "uuid";
// project
import { findProgram, getAvailableLIMAInstances, getAvailableWSLDistributions } from "@/detector";
import { createLogger } from "@/logger";
// module
import { UserConfiguration } from "@/container-config";
import { Command, FS, Path, Platform } from "@/platform/node";
import { EngineConnectorSettings } from "@/web-app/Types.container-app";
import { CURRENT_OS_TYPE } from "../../Environment";
import { createApiDriver, getApiConfig, Runner } from "../api";
import { LIMA_PATH, LIMA_PROGRAM, LIMA_VERSION, WSL_PATH, WSL_PROGRAM, WSL_VERSION } from "../constants";

export class AbstractAdapter {
  public ADAPTER: any = undefined;
  public ENGINES: any = [];

  public userConfiguration: UserConfiguration;
  public osType: any;

  public logger: any;

  static create(a, b?: any) {
    throw new Error("Must implement");
  }

  constructor(userConfiguration: UserConfiguration, osType) {
    this.userConfiguration = userConfiguration;
    this.osType = osType || CURRENT_OS_TYPE;
  }

  async setup() {
    this.logger = await createLogger(`${this.ADAPTER}.adapter`);
    this.logger.debug(this.ADAPTER, "Created adapter");
  }

  createEngines() {
    return this.ENGINES.map((Engine) => this.createEngine(Engine));
  }

  createEngine(Engine) {
    return Engine.create("default", this.userConfiguration, this.osType);
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

export abstract class AbstractClientEngine {
  public PROGRAM!: string;
  public ADAPTER!: string;
  public ENGINE!: string;
  public id!: string;

  protected userConfiguration: UserConfiguration;
  protected osType: any;
  protected apiStarted: any;
  protected detectedSettings: any;
  protected currentSettings!: any;

  protected runner!: Runner;
  protected logger!: any;

  abstract getExpectedSettings();
  abstract startApi(customSettings?: any, opts?: any);
  abstract isEngineAvailable();
  abstract getControllerScopes();

  constructor(userConfiguration, osType) {
    this.userConfiguration = userConfiguration;
    this.osType = osType || CURRENT_OS_TYPE;
    this.apiStarted = false;
    this.detectedSettings = {};
  }

  async setup() {
    this.runner = new Runner(this);
    this.logger = await createLogger("engine.client");
    this.logger.debug(this.id, "Created");
  }

  // Lazy factory
  async getApiDriver(userConfig?: any): Promise<any> {
    const settings = await this.getCurrentSettings();
    const config = await getApiConfig(settings.api.baseURL, settings.api.connectionString);
    const apiDriver = await createApiDriver(config);
    return apiDriver;
  }

  setDetectedSettings(settings) {
    this.detectedSettings = settings;
  }

  async detect(expected) {
    const detected: any = {
      program: {
        name: expected.program.name,
        path: undefined,
        version: undefined
      }
    };
    const available = await this.isEngineAvailable();
    if (available.success) {
      try {
        this.logger.warn(this.id, "Find program MISS", expected.program.name);
        const program = await findProgram(expected.program.name, { osType: this.osType });
        this.logger.warn(this.id, "Find program CACHE", program);
        detected.program.name = expected.program.name;
        detected.program.path = program.path;
        detected.program.version = program.version;
      } catch (error: any) {
        this.logger.error(this.id, `Unable to find ${expected.program.name}`, error.message, error.stack);
      }
    } else {
      this.logger.warn(this.id, "Engine is not available - detection skipped");
    }
    return detected;
  }

  async getUserSettings(): Promise<EngineConnectorSettings> {
    return {
      api: {
        baseURL: "",
        connectionString: ""
      },
      program: {
        name: "",
        path: ""
      }
    };
  }

  async setUserSettings(settings): Promise<EngineConnectorSettings> {
    const defaults = await this.getUserSettings();
    const userSettings = await this.userConfiguration.getKey<EngineConnectorSettings | undefined>(this.id);
    const updated = merge(defaults, userSettings, settings || {});
    await this.userConfiguration.setKey(this.id, updated);
    return updated;
  }

  async getSettings(opts?: any) {
    const expected = await this.getExpectedSettings();
    // Optimization - apply user overrides only if engine is available
    const detected = this.detectedSettings || {};
    let user = {};
    const available = await this.isEngineAvailable();
    if (available.success) {
      user = await this.getUserSettings();
    }
    const settings = {
      expected,
      detected,
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
        expected,
        detected,
        user
      )
    };
    return settings;
  }

  async getCurrentSettings() {
    if (!this.currentSettings) {
      const settings = await this.getSettings();
      this.currentSettings = settings.current;
    }
    return this.currentSettings;
  }

  setCurrentSettings(settings) {
    this.currentSettings = settings;
    return settings;
  }

  async updateSettings() {
    // Creates merged settings - without detections
    const initialSettings = await this.getSettings();
    // Performs detections
    const detected = await this.detect(initialSettings.expected);
    this.setDetectedSettings(detected);
    // Re-merges - now with detections performed
    const updatedSettings = await this.getSettings();
    this.setCurrentSettings(updatedSettings.current);
    return updatedSettings;
  }

  async stopApi(customSettings, opts) {
    if (!this.runner) {
      return true;
    }
    if (!this.apiStarted) {
      this.logger.debug("Stopping API - skip(not started here)");
      return false;
    }
    this.logger.debug("Stopping API - begin");
    return await this.runner.stopApi(customSettings, opts);
  }

  async isProgramAvailable(settings) {
    const result: any = { success: false, details: undefined };
    // Native path to program
    if (!settings.program.path) {
      result.details = "Path not set";
      return result;
    }
    if (!(await FS.isFilePresent(settings.program.path))) {
      result.details = "Not present in path";
      return result;
    }
    result.success = true;
    result.details = "Program is available";
    return result;
  }

  async isApiAvailable() {
    const result: any = { success: false, details: undefined };
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
      availability.report.api = "API check skipped";
    }
    availability.all = availability.engine && availability.program && availability.api;
    return availability;
  }

  async isApiRunning(opts?: any) {
    // Guard configuration
    const available = await this.isApiAvailable();
    if (!available.success) {
      this.logger.debug(this.id, "API is not available - unable to ping", available);
      return available;
    }
    // Test reachability
    const result: any = {
      success: false,
      details: undefined
    };
    const driver = await this.getApiDriver(undefined);
    try {
      const response = await driver.request({ method: "GET", url: "/_ping" });
      result.success = response?.data === "OK";
      result.details = result.success ? "Api is reachable" : response?.data;
    } catch (error: any) {
      result.details = "API is not reachable - start manually or connect";
      this.logger.error(
        this.id,
        "API ping service failed",
        error.message,
        error.response ? { code: error.response.status, statusText: error.response.statusText } : ""
      );
    }
    return result;
  }

  async getConnector(opts?: any) {
    const connector: any = {
      id: this.id,
      adapter: this.ADAPTER, // injected by factory
      engine: this.ENGINE,
      settings: await this.getSettings(opts),
      availability: undefined
    };
    try {
      const current = await this.getCurrentSettings();
      connector.settings.current = merge(
        {},
        connector.settings.expected,
        connector.settings.detected,
        connector.settings.user,
        connector.settings.current,
        current
      );
    } catch (error: any) {
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

  async runScopedCommand(program, args, opts?: any) {
    const { launcher, command } = await this.getScopedCommand(program, args, opts);
    return await Command.Execute(launcher, command, opts);
  }

  // Services

  async getSystemInfo(customFormat) {
    let info = {};
    const { program } = await this.getCurrentSettings();
    const result = await this.runScopedCommand(program.path, ["system", "info", "--format", customFormat || "json"]);
    if (!result.success) {
      this.logger.error(this.id, "Unable to get system info", result);
      return info;
    }
    try {
      info = result.stdout ? JSON.parse(result.stdout) : info;
    } catch (error: any) {
      this.logger.error(this.id, "Unable to decode system info", error, result);
    }
    return info;
  }

  // Clean-up
  async pruneSystem(opts?: any) {
    const input: any = {
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
      args.push(...Object.keys(input.filter).map((key) => `label=${key}=${input.filter[key]}`));
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
      this.logger.debug(this.id, "System prune complete");
    } else {
      this.logger.error(this.id, "System prune error", result);
    }
    return result.success;
  }

  async resetSystem() {
    if (this.PROGRAM === "docker") {
      this.logger.debug(this.id, "No such concept for current engine - skipping");
      return true;
    }
    const { program } = await this.getCurrentSettings();
    const args = ["system", "reset", "--force", "--log-level=debug"];
    const result = await this.runScopedCommand(program.path, args);
    if (result.success) {
      this.logger.debug(this.id, "System reset success", result);
    } else {
      this.logger.error(this.id, "System reset error", result);
    }
    return result.success;
  }
}

export abstract class AbstractControlledClientEngine extends AbstractClientEngine {
  // Helpers
  abstract getConnectionString(scope?: any);
  // Settings
  abstract getExpectedSettings();

  async detect(expected) {
    const detected: any = {
      controller: {
        name: expected.controller.name,
        path: undefined,
        version: expected.controller.version
      },
      program: {
        name: expected.program.name,
        path: undefined,
        version: expected.program.version
      }
    };
    const available = await this.isEngineAvailable();
    if (available.success) {
      try {
        this.logger.debug(this.id, "Find controller MISS", expected.controller.name);
        const controller = await findProgram(expected.controller.name, { osType: this.osType });
        detected.controller.path = controller.path;
        detected.controller.version = controller.version;
        try {
          this.logger.debug(this.id, "Find controller program MISS", expected.program.name);
          const program = await findProgram(expected.program.name, { osType: this.osType, wrapper: controller.path });
          this.logger.debug(this.id, "Find controller program CACHE", expected.program.name, program);
          detected.program.path = program.path;
          detected.program.version = program.version;
        } catch (error: any) {
          this.logger.error(`Unable to find controller program ${expected.program.name}`, error.message, error.stack);
        }
      } catch (error: any) {
        this.logger.error(`Unable to find controller ${expected.controller.name}`, error.message, error.stack);
      }
    }
    return detected;
  }
  async getUserSettings() {
    const entry = await this.userConfiguration.getKey<EngineConnectorSettings | undefined>(this.id);
    return {
      api: {
        baseURL: entry?.api?.baseURL,
        connectionString: entry?.api?.connectionString
      },
      controller: {
        path: entry?.controller?.path,
        scope: entry?.controller?.scope
      },
      program: {
        path: entry?.program?.path
      }
    } as EngineConnectorSettings;
  }
  async getSettings() {
    const expected: any = await this.getExpectedSettings();
    // Optimization - apply user overrides only if engine is available
    const detected: any = this.detectedSettings || {};
    let user = {};
    const available = await this.isEngineAvailable();
    if (available.success) {
      user = await this.getUserSettings();
    }
    const settings = {
      expected,
      detected,
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
        expected,
        detected,
        user
      )
    };
    return settings;
  }

  // Availability
  async isControllerAvailable(settings?: any) {
    let success = false;
    let details;
    if (settings?.controller?.path) {
      if (await FS.isFilePresent(settings.controller.path)) {
        success = true;
        details = "Controller is available";
      } else {
        details = "Not present in path";
      }
    } else {
      details = "Path not set";
    }
    return { success, details };
  }
  async isControllerScopeAvailable(settings?: any) {
    throw new Error("isControllerScopeAvailable must be implemented");
  }
  async isProgramAvailable(settings?: any) {
    let success = false;
    let details;
    if (settings?.program?.path) {
      success = true;
    } else {
      details = "Program path not set";
    }
    return { success, details };
  }
  async getAvailability(settings?: any) {
    const availability = {
      all: false,
      engine: false,
      controller: false,
      controllerScope: false,
      program: false,
      api: false,
      report: {
        engine: "Not checked",
        controller: "Not checked",
        controllerScope: "Not checked",
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
      const controllerScope = await this.isControllerAvailable(settings);
      availability.report.controllerScope = controllerScope.details;
      if (controllerScope.success) {
        availability.controllerScope = true;
      }
    } else {
      availability.report.controllerScope = "Not checked - controller not available";
    }
    if (availability.controllerScope) {
      const program = await this.isProgramAvailable(settings);
      availability.report.program = program.details;
      if (program.success) {
        availability.program = true;
      }
    } else {
      availability.report.program = "Not checked - controller scope not available";
    }
    if (availability.program) {
      const api = await this.isApiRunning();
      availability.report.api = api.details;
      if (api.success) {
        availability.api = true;
      }
    } else {
      availability.report.api = "API check skipped";
    }
    availability.all = availability.engine && availability.controller && availability.program && availability.api;
    return availability;
  }
  async getConnector(opts?: any) {
    const connector = await super.getConnector(opts);
    connector.scopes = await this.getControllerScopes();
    return connector;
  }
  // Executes command inside controller scope
  abstract getScopedCommand(program, args, opts?: any);
  abstract getControllerScopes();
}

export abstract class AbstractClientEngineSubsystemWSL extends AbstractControlledClientEngine {
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
                  stream.write(output ?? "");
                } catch (error: any) {
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
            } catch (error: any) {
              lastError = error;
              this.logger.error(this.ENGINE, "Request invocation error", error.message, error.response?.status);
            }
          });
        });
        return response;
      }
    };
  }

  async getApiDriver(userConfig?: any) {
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
  async startApi(customSettings?: any, opts?: any) {
    this.logger.debug(this.id, "Start api skipped - not required");
    return true;
  }
  async stopApi() {
    this.logger.debug(this.id, "Stop api skipped - not required");
    return true;
  }
  // Availability
  async isControllerScopeAvailable(settings?: any) {
    const result: any = { success: false, details: "Scope is not available" };
    if (settings?.controller?.scope) {
      const instances: any[] = await this.getControllerScopes();
      const target = instances.find((it) => it.Name === settings.controller.scope);
      if (target) {
        result.success = true;
        result.details = "Scope is available";
      }
    }
    return result;
  }
  async isEngineAvailable() {
    const result: any = { success: true, details: "Engine is available" };
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
    const canListScopes = available.success && settings.controller.path;
    const items = canListScopes ? await getAvailableWSLDistributions(settings.controller.path) : [];
    return items;
  }

  // Executes command inside controller scope
  async getScopedCommand(program, args, opts?: any) {
    const { controller } = await this.getCurrentSettings();
    const command = ["--distribution", opts?.scope || controller.scope];
    if (program) {
      command.push(program);
    }
    if (args) {
      command.push(...args);
    }
    return { launcher: controller.path, command };
  }
  async getExpectedSettings() {
    return {
      controller: {
        name: WSL_PROGRAM,
        path: WSL_PATH,
        version: WSL_VERSION
      }
    };
  }
}

export abstract class AbstractClientEngineSubsystemLIMA extends AbstractControlledClientEngine {
  // Helpers
  async getConnectionString(scope) {
    const homeDir = await Platform.getHomeDir();
    return await Path.join(homeDir, ".lima", scope, "sock", `${scope}.sock`);
  }
  // Runtime
  async startApi(customSettings?: any, opts?: any) {
    const running = await this.isApiRunning();
    if (running.success) {
      this.logger.debug(this.id, "API is already running");
      return true;
    }
    const settings = customSettings || (await this.getCurrentSettings());
    // TODO: Safe to stop first before starting ?
    const started = await this.runner.startApi(opts, {
      path: settings.controller.path,
      args: ["start", settings.controller.scope]
    });
    this.apiStarted = started;
    this.logger.debug("Start API complete", started);
    return started;
  }
  async stopApi(customSettings, opts) {
    if (!this.apiStarted) {
      this.logger.debug("Stopping API - skip(not started here)");
      return false;
    }
    this.logger.debug("Stopping API - begin");
    const settings = customSettings || (await this.getCurrentSettings());
    return await this.runner.stopApi(opts, {
      path: settings.controller.path,
      args: ["stop", settings.controller.scope]
    });
  }
  // Availability
  async isControllerScopeAvailable(settings?: any) {
    const result: any = { success: false, details: "Scope is not available" };
    if (settings?.controller?.scope) {
      const instances: any[] = await this.getControllerScopes();
      const target = instances.find((it) => it.Name === settings.controller.scope && target?.Status === "Running");
      if (target) {
        result.success = true;
        result.details = "Scope is available";
      }
    }
    return result;
  }
  async isEngineAvailable() {
    const result: any = { success: true, details: "Engine is available" };
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
    const canListScopes = available.success && settings.controller.path;
    const items = canListScopes ? await getAvailableLIMAInstances(settings.controller.path) : [];
    return items;
  }
  // Executes command inside controller scope
  async getScopedCommand(program?: any, args?: any[], opts?: any) {
    const { controller } = await this.getCurrentSettings();
    const command = ["shell", opts?.scope || controller.scope];
    if (program) {
      command.push(program);
    }
    if (args) {
      command.push(...args);
    }
    return { launcher: controller.path, command };
  }
  async getExpectedSettings() {
    return {
      controller: {
        name: LIMA_PROGRAM,
        path: LIMA_PATH,
        version: LIMA_VERSION
      }
    };
  }
}

export default {
  AbstractAdapter,
  AbstractClientEngine,
  AbstractControlledClientEngine,
  AbstractClientEngineSubsystemWSL,
  AbstractClientEngineSubsystemLIMA
};
