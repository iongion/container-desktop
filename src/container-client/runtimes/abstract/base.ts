import { isEmpty } from "lodash-es";

import { Runner } from "@/container-client/runner";
import { findProgramPath, findProgramVersion } from "@/detector";
import {
  ApiConnection,
  ApiStartOptions,
  AvailabilityCheck,
  CommandExecutionResult,
  Connection,
  ContainerEngine,
  ContainerRuntime,
  ControllerScope,
  EngineConnectorAvailability,
  EngineConnectorSettings,
  ILogger,
  Program,
  RunnerStopperOptions,
  SystemInfo,
  SystemPruneReport,
  SystemResetReport
} from "@/env/Types";
import { createLogger } from "@/logger";
import { OperatingSystem } from "@/platform";
import { deepMerge } from "@/utils";
import { ContainerClient, createApplicationApiDriver } from "../../Api.clients";

export abstract class AbstractRuntime {
  public static RUNTIME: ContainerRuntime;
  public RUNTIME!: ContainerRuntime;
  public ENGINES: (typeof AbstractClientEngine)[] = [];

  public osType: OperatingSystem;

  public logger!: ILogger;

  static create(a, b?: any): Promise<AbstractRuntime> {
    throw new Error("Must implement");
  }

  constructor(osType: OperatingSystem) {
    this.osType = osType || CURRENT_OS_TYPE;
  }

  async setup() {
    this.logger = await createLogger(`${this.RUNTIME}.runtime`);
    this.logger.debug(this.RUNTIME, "Created adapter");
  }

  async createEngine(Engine: typeof AbstractClientEngine, id: string): Promise<AbstractClientEngine> {
    return await Engine.create(id, this.osType);
  }

  async createEngineByName(engine: ContainerEngine, id: string) {
    const Engine = this.ENGINES.find((it) => it.ENGINE === engine);
    if (!Engine) {
      this.logger.error("Unable to find specified engine", engine, "within known engines", this.ENGINES);
      throw new Error("Unable to find specified engine");
    }
    return await this.createEngine(Engine, id);
  }
}

export interface ClientEngine {
  startApi(customSettings?: EngineConnectorSettings, opts?: ApiStartOptions);
  isEngineAvailable();
  getApiConnection(scope?: string): Promise<ApiConnection>;
  // Controller behavior
  isScoped(): boolean;
  getControllerScopes(): Promise<ControllerScope[]>;
  startScope(scope: ControllerScope): Promise<boolean>;
  stopScope(scope: ControllerScope): Promise<boolean>;
  startScopeByName(name: string): Promise<boolean>;
  stopScopeByName(name: string): Promise<boolean>;

  isApiRunning(): Promise<AvailabilityCheck>;
  getSystemInfo(connection?: Connection, customFormat?: string): Promise<SystemInfo>;
}

export abstract class AbstractClientEngine implements ClientEngine {
  public static ENGINE: ContainerEngine;

  public LABEL: string = "Abstract";
  public PROGRAM!: string;
  public CONTROLLER!: string;
  public RUNTIME!: ContainerRuntime;
  public ENGINE!: ContainerEngine;
  public id!: string;

  protected osType: OperatingSystem;
  protected apiStarted: boolean;

  protected runner!: Runner;
  protected settings: EngineConnectorSettings = {
    api: {
      baseURL: "",
      connection: {
        uri: "",
        relay: ""
      }
    },
    program: {
      name: this.PROGRAM,
      path: this.PROGRAM,
      version: ""
    },
    rootfull: false
  };

  public logger!: ILogger;
  protected containerApiClient?: ContainerClient;

  abstract startApi(customSettings?: EngineConnectorSettings, opts?: ApiStartOptions);
  abstract isEngineAvailable();
  abstract getApiConnection(scope?: string): Promise<ApiConnection>;
  // Controller behavior
  abstract isScoped(): boolean;
  abstract getControllerScopes(): Promise<ControllerScope[]>;
  abstract startScope(scope: ControllerScope): Promise<boolean>;
  abstract stopScope(scope: ControllerScope): Promise<boolean>;
  abstract startScopeByName(name: string): Promise<boolean>;
  abstract stopScopeByName(name: string): Promise<boolean>;

  constructor(osType: OperatingSystem) {
    this.osType = osType || CURRENT_OS_TYPE;
    this.apiStarted = false;
  }

  getContainerApiClient() {
    if (!this.containerApiClient) {
      const connection: Connection = {
        name: "Current",
        label: "Current",
        settings: this.settings,
        runtime: this.RUNTIME,
        engine: this.ENGINE,
        id: this.id
      };
      this.containerApiClient = new ContainerClient(connection, createApplicationApiDriver(connection));
    }
    return this.containerApiClient;
  }

  static create(id: string, osType: OperatingSystem): Promise<AbstractClientEngine> {
    throw new Error("Must implement");
  }

  async setup() {
    this.runner = new Runner(this);
    this.logger = await createLogger("engine.client");
    this.logger.debug(this.id, "Client engine created");
  }

  async setSettings(settings: EngineConnectorSettings) {
    this.settings = settings;
  }

  async getSettings(): Promise<EngineConnectorSettings> {
    return this.settings;
  }

  async stopApi(customSettings?: EngineConnectorSettings, opts?: RunnerStopperOptions) {
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

  async isProgramAvailable(settings: EngineConnectorSettings): Promise<AvailabilityCheck> {
    const result: AvailabilityCheck = { success: false, details: undefined };
    const currentSettings = settings || (await this.getSettings());
    const programPath = currentSettings.program.path || currentSettings.program.name;
    // Native path to program
    if (!programPath) {
      result.details = "Path not set";
      return result;
    }
    if (!(await FS.isFilePresent(programPath))) {
      result.details = "Not present in path";
      return result;
    }
    result.success = true;
    result.details = "Program is available";
    return result;
  }

  async isApiAvailable(): Promise<AvailabilityCheck> {
    const result: AvailabilityCheck = { success: false, details: undefined };
    const settings = await this.getSettings();
    if (!settings.api.baseURL) {
      result.details = "API base URL is not set";
      return result;
    }
    if (!settings.api.connection) {
      result.details = "API connection string is not set";
      return result;
    }
    // Check unix socket as file
    if (this.osType === "Windows_NT") {
      // TODO: Check named pipe
    } else {
      // if (!isFilePresent(settings.api.connection)) {
      //   result.details = "API connection string as unix path is not present";
      //   return result;
      // }
    }
    result.success = true;
    result.details = "API is configured";
    return result;
  }

  async isApiRunning() {
    this.logger.debug(this.id, ">> Checking if API is running");
    // Guard configuration
    const available = await this.isApiAvailable();
    if (!available.success) {
      this.logger.debug(this.id, "API is not available - unable to ping", available);
      return available;
    }
    // Test reachability
    const result: AvailabilityCheck = {
      success: false,
      details: undefined
    };
    const client = this.getContainerApiClient();
    const driver = client.getDriver();
    try {
      const response = await driver.request({ method: "GET", url: "/_ping" });
      result.success = response?.data === "OK";
      result.details = result.success ? "Api is reachable" : response?.data;
    } catch (error: any) {
      result.details = "API is not reachable - start manually or connect";
      this.logger.error(this.id, "API ping service failed", error.message, error.response ? { code: error.response.status, statusText: error.response.statusText } : "");
    }
    this.logger.debug(this.id, "<< Checking if API is running", result);
    return result;
  }

  // Executes command inside controller scope

  async runHostCommand(program: string, args?: string[]) {
    const commandLauncher = this.osType === OperatingSystem.Windows && !program.endsWith(".exe") ? `${program}.exe` : program;
    const commandLine = [commandLauncher].concat(args || []).join(" ");
    this.logger.debug(this.id, ">> Running host command", commandLine);
    const result = await Command.Execute(commandLauncher, args || []);
    this.logger.debug(this.id, "<< Running host command", commandLine, { success: result.success, code: result.code, stderr: result.stderr || "" });
    return result;
  }

  // System commands

  async getSystemInfo(connection?: Connection, customFormat?: string) {
    let info: SystemInfo = {} as SystemInfo;
    let result: CommandExecutionResult;
    const settings = await this.getSettings();
    const programPath = settings.program.path || settings.program.name || "";
    if (this.isScoped()) {
      result = await this.runScopeCommand(programPath, ["system", "info", "--format", customFormat || "json"], settings.controller?.scope || "");
    } else {
      result = await this.runHostCommand(programPath, ["system", "info", "--format", customFormat || "json"]);
    }
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
    const settings = await this.getSettings();
    const programPath = settings.program.path || settings.program.name || "";
    let result;
    if (this.isScoped()) {
      result = await this.runScopeCommand(programPath, args, settings.controller?.scope || "");
    } else {
      result = await this.runHostCommand(programPath, args);
    }
    if (result.success) {
      this.logger.debug(this.id, "System prune complete");
      try {
        const report: SystemPruneReport = JSON.parse(result.stdout || "{}");
        return report;
      } catch (error: any) {
        this.logger.error(this.id, "Unable to decode system info", error, result);
      }
    } else {
      this.logger.error(this.id, "System prune error", result);
    }
    throw new Error("Unable to prune system");
  }

  async resetSystem() {
    if (this.PROGRAM === "docker") {
      this.logger.debug(this.id, "No such concept for current engine - skipping");
      return true;
    }
    const settings = await this.getSettings();
    const programPath = settings.program.path || settings.program.name || "";
    const args = ["system", "reset", "--force", "--log-level=debug"];
    let result;
    if (this.isScoped()) {
      result = await this.runScopeCommand(programPath, args, settings.controller?.scope || "");
    } else {
      result = await this.runHostCommand(programPath, args);
    }
    if (result.success) {
      this.logger.debug(this.id, "System reset success", result);
      try {
        const report: SystemResetReport = JSON.parse(result.stdout || "{}");
        return report;
      } catch (error: any) {
        this.logger.error(this.id, "Unable to decode system info", error, result);
      }
    } else {
      this.logger.error(this.id, "System reset error", result);
    }
    throw new Error("Unable to reset system");
  }

  // Controller behavior
  abstract runScopeCommand(program: string, args: string[], scope: string): Promise<CommandExecutionResult>;

  async isControllerAvailable(settings: EngineConnectorSettings) {
    let success = false;
    let details;
    const controllerPath = settings.controller?.path;
    if (controllerPath) {
      if (await FS.isFilePresent(controllerPath)) {
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

  async getAvailability(userSettings?: EngineConnectorSettings) {
    this.logger.debug(this.id, ">> Checking availability");
    const settings = userSettings || (await this.getSettings());
    const enabled = await this.isEngineAvailable();
    const availability: EngineConnectorAvailability = {
      enabled,
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
      const controllerAvailability = await this.isControllerAvailable(settings);
      availability.report.controller = controllerAvailability.details;
      if (controllerAvailability.success) {
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
      availability.report.program = program.details || "";
      if (program.success) {
        availability.program = true;
      }
    } else {
      availability.report.program = "Not checked - controller scope not available";
    }
    const api = await this.isApiRunning();
    availability.report.api = api.details ?? "";
    if (api.success) {
      availability.api = true;
      availability.report.api = "API is running";
    } else {
      availability.api = false;
      availability.report.api = "API is not running";
    }
    this.logger.debug(this.id, "<< Checking availability", availability);
    return availability;
  }

  async getScopeEnvironmentVariable(scope: string, variable: string) {
    let value = "";
    if (this.isScoped()) {
      const settings = await this.getSettings();
      if (settings.controller) {
        if (settings.controller?.scope) {
          this.logger.debug(this.id, "Get scoped environment variable", scope, variable);
          const output = await this.runScopeCommand("printenv", [variable], scope || settings.controller?.scope);
          if (output.success) {
            value = `${output.stdout || ""}`.trim();
            this.logger.debug(this.id, "Scoped environment variable has been read", output);
          } else {
            this.logger.error(this.id, "Scoped environment variable could not be read", output);
          }
        } else {
          this.logger.error(this.id, "Controller scope is not defined", settings.controller);
        }
      } else {
        this.logger.debug(this.id, "Get scoped environment variable", scope, variable);
        return await Platform.getEnvironmentVariable(variable);
      }
    }
    return value;
  }

  async findHostProgram(program: Program): Promise<Program> {
    const output = deepMerge({}, program);
    output.path = await findProgramPath(program.name, { osType: this.osType });
    output.version = await findProgramVersion(output.path, { osType: this.osType });
    return output;
  }

  async findHostProgramVersion(program: Program): Promise<string> {
    return await findProgramVersion(program.path, { osType: this.osType });
  }

  async findScopeProgram(program: Program): Promise<Program> {
    const executor = async (path: string, args: string[]) => {
      const settings = await this.getSettings();
      return await this.runScopeCommand(path, args, settings.controller?.scope || "");
    };
    const output = deepMerge({}, program);
    output.path = await findProgramPath(program.name, { osType: OperatingSystem.Linux }, executor);
    output.version = await findProgramVersion(output.path, { osType: OperatingSystem.Linux }, executor);
    return output;
  }

  async findScopeProgramVersion(program: Program): Promise<string> {
    const executor = async (path: string, args: string[]) => {
      const settings = await this.getSettings();
      return await this.runScopeCommand(path, args, settings.controller?.scope || "");
    };
    return await findProgramVersion(program.path, { osType: OperatingSystem.Linux }, executor);
  }

  async getConnectionDataDir() {
    let dataDir: string | undefined;
    this.logger.debug(this.id, "Get this data dir", this);
    if (this.settings.controller) {
      try {
        if (this.settings.controller.scope) {
          dataDir = await this.getScopeEnvironmentVariable(this.settings.controller.scope, "XDG_DATA_HOME");
          if (isEmpty(dataDir)) {
            this.logger.error(this.id, "Unable to get controller scope data dir using XDG_DATA_HOME");
            const homeDir = await this.getScopeEnvironmentVariable(this.settings.controller.scope, "HOME");
            if (isEmpty(homeDir)) {
              this.logger.error(this.id, "Unable to get controller scope data dir using HOME");
            } else {
              dataDir = `${homeDir}/.local/share`;
            }
          }
        } else {
          if (this.ENGINE === ContainerEngine.PODMAN_VIRTUALIZED_VENDOR) {
            dataDir = await Platform.getUserDataPath();
          } else {
            this.logger.error(this.id, "Controller scope is not defined", this.settings.controller);
            return dataDir || "";
          }
        }
      } catch (error: any) {
        this.logger.error(this.id, "Unable to get controller scope data dir", error.message);
      }
    } else {
      this.logger.error(this.id, "Controller scope is not defined", this);
    }
    const output = dataDir || "$HOME/.local/share";
    this.logger.debug(this.id, "Connection data dir is", output);
    return output;
  }
}
