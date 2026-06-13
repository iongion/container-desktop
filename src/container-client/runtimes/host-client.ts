// runtimes/host-client.ts — the composed HostClient that implements the symmetric HostClientFacade by
// delegating to exactly one Transport (scope mechanics) × one EngineDialect (engine commands + extensions)
// × one HostProfile (per-(engine,host) glue). It IS the HostContext passed to those units.
//
// The byte-for-byte sources (commands / sockets / endpoints) live in the units; this file holds only the
// cross-cutting host state + the generic helpers lifted verbatim from the old runtimes/abstract/base.ts.
//
// State model (consolidated): settings + runner + cached raw driver + identity + capabilities. The former
// dual "api started" state (the old host.apiStarted vs Runner.started) is folded into a single source of
// truth on the Runner (runner.isStarted()); see runner.ts.

import type { AxiosInstance } from "axios";
import type EventEmitter from "eventemitter3";
import { isEmpty } from "lodash-es";

import { systemNotifier } from "@/container-client/notifier";
import { Runner } from "@/container-client/runner";
import {
  type ApiConnection,
  type ApiStartOptions,
  type AvailabilityCheck,
  type CommandExecutionResult,
  type Connection,
  type ContainerEngine,
  ContainerEngineHost,
  type ControllerScope,
  type EngineConnectorAvailability,
  type EngineConnectorSettings,
  type ILogger,
  OperatingSystem,
  type Program,
  type RunnerStopperOptions,
  type StartupStatus,
  type SubscriptionOptions,
  type SystemInfo,
  type SystemPruneReport,
  type SystemResetReport,
} from "@/env/Types";
import { createLogger } from "@/logger";
import { deepMerge } from "@/utils";
import { findProgramPath, findProgramVersion } from "../detector";
import type { EngineDialect, HostContext, HostProfile, Transport } from "./composition";
import type { CapabilityDescriptor, HostClientFacade } from "./facade";

/**
 * The per-(engine,host) composition the registry resolves: the three units plus the identity constants that
 * no single unit carries (PROGRAM = engine binary, CONTROLLER = controller binary). ENGINE comes from the
 * dialect, HOST/LABEL from the profile.
 */
export interface HostClientComposition {
  readonly transport: Transport;
  readonly dialect: EngineDialect;
  readonly profile: HostProfile;
  readonly PROGRAM: string;
  readonly CONTROLLER: string;
}

export class HostClient implements HostContext {
  // identity (was base.ts:109-114,138 + the leaf overrides)
  public LABEL: string;
  public PROGRAM: string;
  public CONTROLLER: string;
  public ENGINE: ContainerEngine;
  public HOST: ContainerEngineHost;
  public id!: string;
  public logger!: ILogger;

  // capability matrix (host-adjusted): dialect.capabilitiesBase -> profile.adjustCapabilities (Finding B)
  public capabilities: CapabilityDescriptor;

  // composition units + collaborators (the HostContext surface)
  public readonly osType: OperatingSystem;
  public readonly transport: Transport;
  public readonly dialect: EngineDialect;
  public readonly profile: HostProfile;
  public runner!: Runner;

  // state
  protected logLevel = "debug";
  protected settings: EngineConnectorSettings;
  protected cachedDriver?: AxiosInstance;

  // Engine-extension methods (the 23 symmetric facade members) — bound from dialect.bindExtensions(this) in
  // setup(); real on this dialect's engine, no-op on the other. Declared here so `implements HostContext`
  // proves completeness at compile time even though the bodies are spread on at runtime.
  getPodmanMachineInspect!: HostClientFacade["getPodmanMachineInspect"];
  getPodmanMachines!: HostClientFacade["getPodmanMachines"];
  createPodmanMachine!: HostClientFacade["createPodmanMachine"];
  removePodmanMachine!: HostClientFacade["removePodmanMachine"];
  startPodmanMachine!: HostClientFacade["startPodmanMachine"];
  stopPodmanMachine!: HostClientFacade["stopPodmanMachine"];
  restartPodmanMachine!: HostClientFacade["restartPodmanMachine"];
  connectToPodmanMachine!: HostClientFacade["connectToPodmanMachine"];
  generateKube!: HostClientFacade["generateKube"];
  getPodLogs!: HostClientFacade["getPodLogs"];
  getDockerContexts!: HostClientFacade["getDockerContexts"];
  inspectDockerContext!: HostClientFacade["inspectDockerContext"];
  useDockerContext!: HostClientFacade["useDockerContext"];
  getSwarmServices!: HostClientFacade["getSwarmServices"];
  getSwarmNodes!: HostClientFacade["getSwarmNodes"];
  getSwarmStacks!: HostClientFacade["getSwarmStacks"];
  swarmInit!: HostClientFacade["swarmInit"];
  swarmLeave!: HostClientFacade["swarmLeave"];
  getBuilders!: HostClientFacade["getBuilders"];
  useBuilder!: HostClientFacade["useBuilder"];
  getComposeProjects!: HostClientFacade["getComposeProjects"];
  composeUp!: HostClientFacade["composeUp"];
  composeDown!: HostClientFacade["composeDown"];

  constructor(composition: HostClientComposition, osType: OperatingSystem) {
    this.osType = osType || CURRENT_OS_TYPE;
    this.transport = composition.transport;
    this.dialect = composition.dialect;
    this.profile = composition.profile;
    this.ENGINE = composition.dialect.ENGINE;
    this.HOST = composition.profile.HOST;
    this.LABEL = composition.profile.LABEL;
    this.PROGRAM = composition.PROGRAM;
    this.CONTROLLER = composition.CONTROLLER;
    this.capabilities = composition.profile.adjustCapabilities(composition.dialect.capabilitiesBase);
    this.settings = {
      api: {
        baseURL: "",
        connection: {
          uri: "",
          relay: "",
        },
      },
      program: {
        name: this.PROGRAM,
        path: this.PROGRAM,
        version: "",
      },
      rootfull: false,
      mode: "mode.automatic",
    };
  }

  static async create(composition: HostClientComposition, id: string, osType: OperatingSystem) {
    const instance = new HostClient(composition, osType);
    instance.id = id;
    await instance.setup();
    return instance;
  }

  async setup() {
    this.runner = new Runner(this);
    this.logger = createLogger("host.client");
    // Spread the dialect's host-bound extension methods (real on its engine, no-op on the other).
    Object.assign(this, this.dialect.bindExtensions(this));
    this.logger.debug(this.id, "Client host created", this.settings);
  }

  // ── identity / logging ──

  setLogLevel(level: string): void {
    console.debug("Setting container engine host client log level", level);
    this.logLevel = level;
  }

  // ── settings ──

  async getSettings(): Promise<EngineConnectorSettings> {
    return this.settings;
  }

  async setSettings(settings: EngineConnectorSettings) {
    this.settings = settings;
  }

  getAutomaticSettings(): Promise<EngineConnectorSettings> {
    return this.profile.getAutomaticSettings(this, this.settings);
  }

  // ── raw API driver (replaces getContainerApiClient(); SSH injects its establishment hook in the transport) ──

  async getApiDriver(): Promise<AxiosInstance> {
    if (!this.cachedDriver) {
      this.cachedDriver = await this.transport.getApiDriver(this, this.settings);
    }
    return this.cachedDriver;
  }

  // ── lifecycle / API (scope + start/stop delegated to the transport, availability to the profile) ──

  startApi(customSettings?: EngineConnectorSettings, opts?: ApiStartOptions): Promise<boolean> {
    return this.transport.startApi(this, customSettings, opts);
  }

  stopApi(customSettings?: EngineConnectorSettings, opts?: RunnerStopperOptions): Promise<boolean> {
    return this.transport.stopApi(this, customSettings, opts);
  }

  isEngineAvailable(): Promise<AvailabilityCheck> {
    return this.profile.isEngineAvailable(this);
  }

  getApiConnection(connection?: Connection, customSettings?: EngineConnectorSettings): Promise<ApiConnection> {
    return this.profile.getApiConnection(this, connection, customSettings);
  }

  // ── scope (controller) — delegated to the transport ──

  isScoped(): boolean {
    return this.transport.isScoped;
  }

  getControllerScopes(
    customSettings?: EngineConnectorSettings,
    skipAvailabilityCheck?: boolean,
  ): Promise<ControllerScope[]> {
    return this.transport.listScopes(this, customSettings, skipAvailabilityCheck);
  }

  getControllerDefaultScope(customSettings?: EngineConnectorSettings): Promise<ControllerScope | undefined> {
    return this.transport.getControllerDefaultScope(this, customSettings);
  }

  startScope(scope: ControllerScope): Promise<StartupStatus> {
    return this.transport.startScope(this, scope);
  }

  stopScope(scope: ControllerScope): Promise<boolean> {
    return this.transport.stopScope(this, scope);
  }

  startScopeByName(name: string): Promise<StartupStatus> {
    return this.transport.startScopeByName(this, name);
  }

  stopScopeByName(name: string): Promise<boolean> {
    return this.transport.stopScopeByName(this, name);
  }

  runScopeCommand(
    program: string,
    args: string[],
    scope: string,
    settings?: EngineConnectorSettings,
  ): Promise<CommandExecutionResult> {
    return this.transport.runScopeCommand(this, program, args, scope, settings);
  }

  // ── system / events (system info delegated to the dialect; events stream uses the raw driver) ──

  getSystemInfo(
    connection?: Connection,
    customFormat?: string,
    customSettings?: EngineConnectorSettings,
  ): Promise<SystemInfo> {
    return this.dialect.getSystemInfo(this, connection, customFormat, customSettings);
  }

  // No-op one-shot events fetch (symmetric facade): the live path is getEventsStream(); there is no
  // one-shot consumer today. Return empty rather than throwing so the facade contract holds for every host.
  getEvents(_opts?: SubscriptionOptions): Promise<any[]> {
    return Promise.resolve([]);
  }

  // ===== generic helpers lifted verbatim from runtimes/abstract/base.ts =====

  async runHostCommand(program: string, args?: string[], settings?: EngineConnectorSettings) {
    const commandLauncher =
      this.osType === OperatingSystem.Windows && !program.endsWith(".exe") ? `${program}.exe` : program;
    const commandLine = [commandLauncher].concat(args || []).join(" ");
    this.logger.debug(this.id, ">> Running host command", commandLine);
    const result = await Command.Execute(commandLauncher, args || []);
    this.logger.debug(this.id, "<< Running host command", commandLine, {
      success: result.success,
      code: result.code,
      stderr: result.stderr || "",
    });
    return result;
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
      this.logger.error(result.details);
      return result;
    }
    if (!settings.api.connection) {
      result.details = "API connection string is not set";
      this.logger.error(result.details);
      return result;
    }
    // Check unix socket as file
    if (this.osType === OperatingSystem.Windows) {
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
    systemNotifier.transmit("engine.availability", {
      trace: "Checking if API is running",
    });
    this.logger.debug(this.id, ">> Checking if API is running");
    // Guard configuration
    const available = await this.isApiAvailable();
    if (!available.success) {
      this.logger.error(this.id, "API is not available - unable to ping", available);
      return available;
    }
    // Test reachability
    const result: AvailabilityCheck = {
      success: false,
      details: undefined,
    };
    const driver = await this.getApiDriver();
    systemNotifier.transmit("engine.availability", {
      trace: "Performing api health check - start",
    });
    try {
      const response = await driver.request({
        method: "GET",
        url: "/_ping",
        timeout: 3000,
      });
      result.success = response?.data === "OK";
      result.details = result.success ? "Api is reachable" : response?.data;
      if (!result.success) {
        this.logger.error(this.id, "API ping service failed - response error", response);
      }
    } catch (error: any) {
      result.details = "API is not reachable - start manually or connect";
      this.logger.error(this.id, "API ping service failed - response failure", error, driver);
    }
    systemNotifier.transmit("engine.availability", {
      trace: "Performing api health check - complete",
    });
    this.logger.debug(this.id, "<< Checking if API is running", result);
    return result;
  }

  async pruneSystem(opts?: any) {
    const input: any = {
      all: true,
      filter: {},
      force: true,
      volumes: false,
      ...(opts || {}),
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
    let result: CommandExecutionResult;
    if (this.isScoped()) {
      result = await this.runScopeCommand(programPath, args, settings.controller?.scope || "");
    } else {
      result = await this.runHostCommand(programPath, args);
    }
    if (result.success) {
      this.logger.debug(this.id, "System prune complete", result);
      try {
        // TODO: Parse report
        const report: SystemPruneReport = {} as any;
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
      this.logger.debug(this.id, "No such concept for current host - skipping");
      return true;
    }
    const settings = await this.getSettings();
    const programPath = settings.program.path || settings.program.name || "";
    const args = ["system", "reset", "--force", "--log-level=debug"];
    let result: CommandExecutionResult;
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

  async getEventsStream(opts?: SubscriptionOptions) {
    try {
      this.logger.warn(this.id, "Subscribing to connection events - creating api client", opts);
      const driver = await this.getApiDriver();
      this.logger.warn(this.id, "Subscribing to connection events - issuing request");
      const response = await driver.get("/events", {
        timeout: 0,
        responseType: "stream",
      });
      return response.data as EventEmitter;
    } catch (error: any) {
      this.logger.error(
        this.id,
        "Subscribing to connection events failed",
        error.message,
        error.response
          ? {
              code: error.response.status,
              statusText: error.response.statusText,
            }
          : "",
      );
    }
  }

  async isControllerAvailable(settings: EngineConnectorSettings) {
    let success = false;
    let details: string | undefined;
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
    systemNotifier.transmit("engine.availability", {
      trace: "Detecting host availability",
    });
    const check = await this.isEngineAvailable();
    const availability: EngineConnectorAvailability = {
      enabled: check.success,
      host: false,
      controller: false,
      controllerScope: false,
      program: false,
      api: false,
      report: {
        host: "Not checked",
        controller: "Not checked",
        controllerScope: "Not checked",
        program: "Not checked",
        api: "Not checked",
      },
    };
    availability.report.host = check.details || "";
    if (check.success) {
      availability.host = true;
    }
    if (availability.host) {
      systemNotifier.transmit("engine.availability", {
        trace: "Detecting host program availability",
      });
      const controllerAvailability = await this.isControllerAvailable(settings);
      availability.report.controller = controllerAvailability.details;
      if (controllerAvailability.success) {
        availability.controller = true;
      }
    } else {
      availability.report.controller = "Not checked - host not available";
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
      systemNotifier.transmit("engine.availability", {
        trace: "Detecting guest program availability",
      });
      const program = await this.isProgramAvailable(settings);
      availability.report.program = program.details || "";
      if (program.success) {
        availability.program = true;
      }
    } else {
      availability.report.program = "Not checked - controller scope not available";
    }
    systemNotifier.transmit("engine.availability", {
      trace: "Detecting guest api availability",
    });
    const api = await this.isApiRunning();
    availability.report.api = api.details ?? "";
    if (api.success) {
      availability.api = true;
      availability.report.api = "API is running";
    } else {
      availability.api = false;
      availability.report.api = "API is not running";
    }
    systemNotifier.transmit("engine.availability", {
      trace: "Availability check complete",
    });
    this.logger.debug(this.id, "<< Checking availability", availability);
    return availability;
  }

  async getScopeEnvironmentVariable(scope: string, variable: string): Promise<string> {
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
        // NOTE: tightened to "" (was string | undefined) to satisfy the HostContext contract; callers isEmpty()-check.
        return (await Platform.getEnvironmentVariable(variable)) || "";
      }
    }
    return value;
  }

  async findHostProgram(program: Program, settings?: EngineConnectorSettings): Promise<Program> {
    systemNotifier.transmit("engine.availability", {
      trace: `Detecting host ${program.name} program path and version`,
    });
    const output = deepMerge({}, program);
    output.path = await findProgramPath(program.name, { osType: this.osType });
    output.version = await findProgramVersion(output.path, {
      osType: this.osType,
    });
    return output;
  }

  async findHostProgramVersion(program: Program, settings?: EngineConnectorSettings): Promise<string> {
    return await findProgramVersion(program.path, { osType: this.osType });
  }

  async findScopeProgram(program: Program, settings?: EngineConnectorSettings): Promise<Program> {
    systemNotifier.transmit("engine.availability", {
      trace: `Detecting guest ${program.name} program path and version`,
    });
    const executor = async (path: string, args: string[]) => {
      const userSettings = settings || (await this.getSettings());
      return await this.runScopeCommand(path, args, userSettings.controller?.scope || "");
    };
    const output = deepMerge({}, program);
    output.path = await findProgramPath(program.name, { osType: OperatingSystem.Linux }, executor);
    output.version = await findProgramVersion(output.path, { osType: OperatingSystem.Linux }, executor);
    return output;
  }

  async findScopeProgramVersion(program: Program, settings?: EngineConnectorSettings): Promise<string> {
    const executor = async (path: string, args: string[]) => {
      const userSettings = settings || (await this.getSettings());
      return await this.runScopeCommand(path, args, userSettings.controller?.scope || "");
    };
    return await findProgramVersion(program.path, { osType: OperatingSystem.Linux }, executor);
  }

  async getConnectionDataDir() {
    systemNotifier.transmit("engine.availability", {
      trace: "Detecting connection system data dir",
    });
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
          if (this.HOST === ContainerEngineHost.PODMAN_VIRTUALIZED_VENDOR) {
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
