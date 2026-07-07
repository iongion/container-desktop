// runtimes/host-client.ts — the composed HostClient that implements the symmetric HostClientFacade by
// delegating to exactly one Transport (scope mechanics) × one EngineDialect (engine commands + extensions)
// × one HostProfile (per-(engine,host) glue). It IS the HostContext passed to those units.
//
// The per-unit sources (commands / sockets / endpoints) live in the units; this file holds only the
// cross-cutting host state + the generic host helpers.
//
// State model: settings + runner + cached raw driver + identity + capabilities. The "api started" state is
// a single source of truth on the Runner (runner.isStarted()); see runner.ts.

import type { AxiosInstance } from "axios";
import type EventEmitter from "eventemitter3";
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
  type HostExecOptions,
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
import { createLogger } from "@/platform/logger";
import { deepMerge, isEmpty } from "@/utils";
import { findProgramPath, findProgramVersion, isWindowsProgramPath } from "../detector";
import type { EngineDialect, HostContext, HostProfile, Transport } from "./composition";
import type { ApiSurface, CapabilityDescriptor, HostClientFacade } from "./facade";

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

  // REST API shape ("docker" or "libpod") — set from the dialect, used by adapters for baseURL/normalizers.
  public apiSurface: ApiSurface;

  // composition units + collaborators (the HostContext surface)
  public readonly osType: OperatingSystem;
  public readonly transport: Transport;
  public readonly dialect: EngineDialect;
  public readonly profile: HostProfile;
  public runner!: Runner;

  // state
  protected logLevel = "warn";
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
    this.apiSurface = composition.dialect.apiSurface;
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

  // identity / logging

  setLogLevel(level: string): void {
    this.logger?.debug(this.id, "Setting container engine host client log level", level);
    this.logLevel = level;
  }

  // settings

  async getSettings(): Promise<EngineConnectorSettings> {
    return this.settings;
  }

  async setSettings(settings: EngineConnectorSettings) {
    this.settings = settings;
  }

  getAutomaticSettings(): Promise<EngineConnectorSettings> {
    return this.profile.getAutomaticSettings(this, this.settings);
  }

  // raw API driver (replaces getContainerApiClient(); SSH injects its establishment hook in the transport)

  async getApiDriver(): Promise<AxiosInstance> {
    if (!this.cachedDriver) {
      this.cachedDriver = await this.transport.getApiDriver(this, this.settings);
    }
    return this.cachedDriver;
  }

  // lifecycle / API (scope + start/stop delegated to the transport, availability to the profile)

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

  // scope (controller) — delegated to the transport

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
    execOpts?: HostExecOptions,
  ): Promise<CommandExecutionResult> {
    return this.transport.runScopeCommand(this, program, args, scope, settings, execOpts);
  }

  runScopeCommandStreaming(
    program: string,
    args: string[],
    scope: string,
    settings?: EngineConnectorSettings,
  ): Promise<StreamHandle> {
    return this.transport.runScopeCommandStreaming(this, program, args, scope, settings);
  }

  resolveGuestPath(localPath: string, scope: string, settings?: EngineConnectorSettings): Promise<string> {
    return this.transport.resolveGuestPath(this, localPath, scope, settings);
  }

  // system / events (system info delegated to the dialect; events stream uses the raw driver)

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

  // Generic host helpers.

  async runHostCommand(
    program: string,
    args?: string[],
    _settings?: EngineConnectorSettings,
    execOpts?: HostExecOptions,
  ) {
    const commandLauncher =
      this.osType === OperatingSystem.Windows && !program.endsWith(".exe") ? `${program}.exe` : program;
    const commandLine = [commandLauncher].concat(args || []).join(" ");
    this.logger.debug(this.id, ">> Running host command", commandLine);
    // Base exec opts preserve the prior behavior (host-side proxy env when unscoped); `input` is added only when a
    // caller pipes secret stdin (registry `login --password-stdin`, `cat > ca.crt`) so it never touches argv/logs.
    const executeOpts: { proxyEnv?: boolean; input?: string } = this.isScoped() ? {} : { proxyEnv: true };
    if (execOpts?.input !== undefined) {
      executeOpts.input = execOpts.input;
    }
    const result = await Command.Execute(
      commandLauncher,
      args || [],
      Object.keys(executeOpts).length > 0 ? executeOpts : undefined,
    );
    this.logger.debug(this.id, "<< Running host command", commandLine, {
      success: result.success,
      code: result.code,
      stderr: result.stderr || "",
    });
    return result;
  }

  // Streaming twin of runHostCommand: spawns the same launcher via Command.ExecuteStreaming and returns the
  // live StreamHandle. The scoped/remote build streams its wrapper CLI (wsl/limactl/ssh) through this.
  async runHostCommandStreaming(program: string, args?: string[]): Promise<StreamHandle> {
    const commandLauncher =
      this.osType === OperatingSystem.Windows && !program.endsWith(".exe") ? `${program}.exe` : program;
    this.logger.debug(this.id, ">> Running host command (streaming)", [commandLauncher].concat(args || []).join(" "));
    return await Command.ExecuteStreaming(
      commandLauncher,
      args || [],
      this.isScoped() ? undefined : { proxyEnv: true },
    );
  }

  async isProgramAvailable(settings: EngineConnectorSettings): Promise<AvailabilityCheck> {
    const result: AvailabilityCheck = { success: false, details: undefined };
    const currentSettings = settings || (await this.getSettings());
    const programName = currentSettings.program.name || this.PROGRAM;
    const programPath = currentSettings.program.path || programName;
    if (!programName) {
      result.details = "Engine program is not configured";
      return result;
    }
    if (this.isScoped()) {
      // Scoped hosts (SSH / WSL / LIMA) run the engine INSIDE the scope — the binary lives on the
      // remote/VM, so presence must be verified IN THE HOST, not against the local filesystem (mirrors
      // isApiAvailable's !isScoped guard). The scope is already started by the time getAvailability runs
      // (Application.connectHostClient), so runScopeCommand is live.
      try {
        const probe = await this.runScopeCommand(
          "which",
          [currentSettings.program.name],
          currentSettings.controller?.scope || "",
          currentSettings,
        );
        if (!probe.success) {
          result.details = `Program "${programName}" was not found`;
          return result;
        }
      } catch (error: any) {
        this.logger.error(this.id, "Scoped program availability check failed", error);
        const scope = currentSettings.controller?.scope;
        result.details = scope
          ? `Program "${programName}" could not be checked in ${scope}`
          : `Program "${programName}" could not be checked in the remote host`;
        return result;
      }
    } else if (!(await FS.isFilePresent(programPath))) {
      result.details =
        programPath === programName
          ? `Program "${programName}" was not detected on this machine`
          : `Program "${programName}" was not found at ${programPath}`;
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
    // A set-but-wrong native unix socket path is the common failure (the path IS set, it just
    // doesn't point to a socket) — name it precisely instead of a vague "not reachable". Scoped
    // hosts relay the socket remotely, so this local-file check only applies to native hosts.
    if (this.osType === OperatingSystem.Windows) {
      // TODO: Check named pipe
    } else if (!this.isScoped()) {
      const socketPath = (settings.api.connection.uri || "").replace(/^unix:\/\//, "");
      if (socketPath && !(await FS.isFilePresent(socketPath))) {
        result.details = `No socket at ${socketPath} — check the connection path`;
        this.logger.error(result.details);
        return result;
      }
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
    const { attachTimeoutMs, ...params } = opts ?? {};
    // The /events response is a LONG-LIVED stream: it must NOT carry a finite read-timeout. A finite axios
    // `timeout` (and the keep-alive socket agent derived from it) aborts the mostly-idle stream a few seconds
    // after it opens, so the drop handler re-subscribes — turning an events-first stream into a reconnect
    // POLL loop. So issue it untimed (timeout: 0), exactly like the container-logs stream. `attachTimeoutMs`
    // bounds ONLY the attach (how long we wait for the stream to open) via an abort signal we clear the moment
    // the stream opens — so a slow attach is aborted cleanly instead of orphaning an open stream.
    const controller = new AbortController();
    const attachTimer =
      attachTimeoutMs && attachTimeoutMs > 0 ? setTimeout(() => controller.abort(), attachTimeoutMs) : undefined;
    try {
      this.logger.debug(this.id, "Subscribing to connection events - creating api client", opts);
      const driver = await this.getApiDriver();
      this.logger.debug(this.id, "Subscribing to connection events - issuing request");
      const response = await driver.get("/events", {
        params,
        timeout: 0,
        responseType: "stream",
        signal: controller.signal,
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
    } finally {
      if (attachTimer) {
        clearTimeout(attachTimer);
      }
    }
  }

  async isControllerAvailable(settings: EngineConnectorSettings) {
    let success = false;
    let details: string | undefined;
    const controllerName = settings.controller?.name || this.CONTROLLER;
    const controllerPath = settings.controller?.path || "";
    if (controllerPath) {
      if (await FS.isFilePresent(controllerPath)) {
        success = true;
        details = "Controller is available";
      } else {
        details = `Controller "${controllerName}" was not found at ${controllerPath}`;
      }
    } else {
      details = controllerName
        ? `Controller "${controllerName}" was not detected on this machine`
        : "Controller program is not configured";
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
    // Controller + scope apply only to scoped hosts (WSL / LIMA / SSH / podman-machine). Native hosts
    // have no controller, so those dimensions stay undefined ("not applicable") rather than being
    // reported as a failure with a misleading "Path not set".
    const scoped = this.isScoped();
    const availability: EngineConnectorAvailability = {
      enabled: check.success,
      host: false,
      controller: scoped ? false : undefined,
      controllerScope: scoped ? false : undefined,
      program: false,
      api: false,
      report: {
        host: "Not checked",
        controller: scoped ? "Not checked" : undefined,
        controllerScope: scoped ? "Not checked" : undefined,
        program: "Not checked",
        api: "Not checked",
      },
    };
    availability.report.host = check.details || "";
    if (check.success) {
      availability.host = true;
    }
    if (availability.host && scoped) {
      systemNotifier.transmit("engine.availability", {
        trace: "Detecting host controller availability",
      });
      const controllerAvailability = await this.isControllerAvailable(settings);
      availability.report.controller = controllerAvailability.details;
      if (controllerAvailability.success) {
        availability.controller = true;
      }
      if (availability.controller) {
        // NOTE: controllerScope currently mirrors the controller check.
        const controllerScope = await this.isControllerAvailable(settings);
        availability.report.controllerScope = controllerScope.details;
        if (controllerScope.success) {
          availability.controllerScope = true;
        }
      } else {
        availability.report.controllerScope = "Not checked - controller not available";
      }
    } else if (scoped) {
      availability.report.controller = "Not checked - host not available";
      availability.report.controllerScope = "Not checked - controller not available";
    }
    // The program lives inside the scope for scoped hosts, or directly on the host for native ones.
    const canCheckProgram = availability.host && (scoped ? Boolean(availability.controllerScope) : true);
    if (canCheckProgram) {
      systemNotifier.transmit("engine.availability", {
        trace: "Detecting guest program availability",
      });
      const program = await this.isProgramAvailable(settings);
      availability.report.program = program.details || "";
      if (program.success) {
        availability.program = true;
      }
    } else if (!availability.host) {
      availability.report.program = "Not checked - host not available";
    } else {
      availability.report.program = "Not checked - controller scope not available";
    }
    systemNotifier.transmit("engine.availability", {
      trace: "Detecting guest api availability",
    });
    const api = await this.isApiRunning();
    if (api.success) {
      availability.api = true;
      availability.report.api = "API is running";
    } else {
      availability.api = false;
      // Preserve the specific reason (e.g. "No socket at …") rather than a generic message.
      availability.report.api = api.details || "API is not running";
    }
    // Optional API-bridge note (e.g. Apple/socktainer presence/version) folded into the api report line,
    // so a missing/lagging bridge is visible — not just logged. No-op for Docker/Podman (native REST).
    if (this.dialect.describeApiBridge) {
      try {
        const note = await this.dialect.describeApiBridge(this, settings);
        if (note) {
          availability.report.api = availability.report.api ? `${availability.report.api} · ${note}` : note;
          this.logger.info(this.id, "API bridge", note);
        }
      } catch (error: any) {
        this.logger.warn(this.id, "Unable to describe API bridge", error);
      }
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
    // Scoped/remote hosts are usually POSIX (Linux VM / macOS over SSH) — try that first so those paths stay
    // byte-for-byte unchanged (no extra round-trip). A Windows SSH remote runs cmd.exe, which has no
    // `which`/`whereis`; fall back to `where` and remember the OS so the version call quotes the path.
    let osType = OperatingSystem.Linux;
    let path = await findProgramPath(program.name, { osType: OperatingSystem.Linux }, executor);
    if (!path) {
      const windowsPath = await findProgramPath(program.name, { osType: OperatingSystem.Windows }, executor);
      if (windowsPath) {
        path = windowsPath;
        osType = OperatingSystem.Windows;
      }
    }
    output.path = path || "";
    output.version = path ? await findProgramVersion(path, { osType }, executor) : "";
    return output;
  }

  async findScopeProgramVersion(program: Program, settings?: EngineConnectorSettings): Promise<string> {
    const executor = async (path: string, args: string[]) => {
      const userSettings = settings || (await this.getSettings());
      return await this.runScopeCommand(path, args, userSettings.controller?.scope || "");
    };
    // Infer the remote OS from the path shape (C:\...\docker.exe ⇒ Windows) so the version call quotes and
    // invokes it correctly over cmd.exe; POSIX paths keep the Linux behavior.
    const osType = isWindowsProgramPath(program.path) ? OperatingSystem.Windows : OperatingSystem.Linux;
    return await findProgramVersion(program.path, { osType }, executor);
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
