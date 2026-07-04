import { normalizeAISettings } from "@/ai-system/core";
import {
  createComposedHostClient,
  createConnectorBy,
  getDefaultConnectors,
  type HostClientFacade,
} from "@/container-client";
import {
  describeConnectError,
  detectOperatingSystem,
  normalizeEngineThemePreference,
  normalizeTheme,
} from "@/container-client/application/environment";
import { AUTOMATIC_REGISTRIES, PROPOSED_REGISTRIES } from "@/container-client/application/registries";
import {
  buildDockerSearchArgs,
  buildImageSearchParams,
  buildPodmanSearchArgs,
  normalizeAndSortSearchResults,
  normalizeSearchOutput,
} from "@/container-client/application/registrySearch";
import { createSecurityReport, parseTrivyAnalysis, parseTrivyDatabase } from "@/container-client/application/security";
import { UserConfiguration } from "@/container-client/config";
import {
  buildMockConnections,
  MOCK_CONTAINER_SYSTEM_ID,
  MOCK_DOCKER_SYSTEM_ID,
  MOCK_PODMAN_SYSTEM_ID,
  mockAvailability,
} from "@/container-client/mock/connections";
import { loadEngineFixtures } from "@/container-client/mock/fixturesLoader";
import { getMockEngine, isMockMode } from "@/container-client/mock/mode";
import { systemNotifier } from "@/container-client/notifier";
import { normalizeProxyConfig, type ProxyConfig } from "@/container-client/proxy";
import { buildRemoteConnectionsFromEnv, resolveRemoteEnvConnections } from "@/container-client/remote-env";
import {
  type ApplicationEnvironment,
  type CommandExecutionResult,
  type Connection,
  type ConnectOptions,
  type Connector,
  type ContainerConnectOptions,
  ContainerEngine,
  ContainerEngineHost,
  type ControllerScope,
  type CreateMachineOptions,
  type DisconnectOptions,
  type EngineConnectorAvailability,
  type EngineConnectorSettings,
  type GlobalUserSettings,
  type ILogger,
  type OpenFileSelectorOptions,
  type OpenTerminalOptions,
  OperatingSystem,
  type Program,
  type RegistriesMap,
  type RegistryPullOptions,
  type RegistrySearchOptions,
  StartupStatus,
  type SubscriptionOptions,
} from "@/env/Types";
import { getWindowsPipePath } from "@/platform";
import { createLogger, getLevel, setLevel } from "@/platform/logger";
import { normalizeLoggingFileSettings } from "@/platform/logger/loggingSettings";
import { deepMerge } from "@/utils";

// Re-export the helpers that moved to ./application/* so Application.ts keeps its historical
// named exports (detectOperatingSystem, normalizeAndSortSearchResults) byte-for-byte.
export { detectOperatingSystem, normalizeAndSortSearchResults };

// A tiny, dependency-free stable hash (FNV-1a 32-bit → 8 hex). This module is bundled into the renderer, where
// Node builtins like node:crypto are unavailable — so we hash in plain JS to keep a short, deterministic
// forward-socket filename that fits the ~104-byte Unix-domain-socket path limit.
function shortStableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export class Application {
  private static instance: Application;

  protected logLevel = "warn";
  protected logger!: ILogger;
  protected messageBus!: IMessageBus;
  protected userConfiguration!: UserConfiguration;
  protected osType: OperatingSystem;
  protected version: string;
  protected environment: string;
  protected connectionApis: {
    [key: string]: HostClientFacade;
  } = {};
  protected inited = false;
  protected connectors: Connector[] = [];

  protected _currentContainerEngineHostClient!: HostClientFacade;

  constructor(opts: ApplicationEnvironment) {
    this.osType = opts.osType;
    this.version = opts.version;
    this.environment = opts.environment;
    this.messageBus = opts.messageBus;
    this.userConfiguration = new UserConfiguration();
  }

  static getInstance() {
    if (!Application.instance) {
      Application.instance = new Application({
        osType: detectOperatingSystem(),
        version: import.meta.env.PROJECT_VERSION,
        environment: import.meta.env.ENVIRONMENT,
        messageBus: (window as any).MessageBus,
      });
    }
    return Application.instance;
  }

  // Main-process construction: seed the singleton explicitly (Node OS type + a main-side messageBus)
  // so the engine adapters' getActiveHostClient() resolves in main without a `window`/`navigator`.
  // The renderer keeps using getInstance() unchanged.
  static initInstance(env: ApplicationEnvironment): Application {
    Application.instance = new Application(env);
    return Application.instance;
  }

  setLogLevel(level: string) {
    this.logger?.debug("Setting application log level", level);
    try {
      const currentApi = this.getCurrentEngineConnectionApi<HostClientFacade>();
      if (currentApi) {
        currentApi.setLogLevel(level);
      }
    } catch (error: any) {
      this.logger?.error("Unable to set log level", error);
    }
    this.logLevel = level;
  }

  getConnectors() {
    return this.connectors;
  }

  getOsType() {
    return this.osType;
  }

  notify(message: any, payload?: any) {
    try {
      this.logger.debug("Application notify", { message, payload });
      this.messageBus.send("notify", { message, payload });
    } catch (error: any) {
      this.logger.error("Unable to notify", error);
    }
  }

  minimize() {
    try {
      this.logger.debug("Application minimize");
      this.messageBus.send("window.minimize");
    } catch (error: any) {
      this.logger.error("Unable to minimize", error);
    }
  }
  maximize() {
    this.logger.debug("Application maximize");
    try {
      this.messageBus.send("window.maximize");
    } catch (error: any) {
      this.logger.error("Unable to maximize", error);
    }
  }
  restore() {
    this.logger.debug("Application restore");
    try {
      this.messageBus.send("window.restore");
    } catch (error: any) {
      this.logger.error("Unable to restore", error);
    }
  }
  close() {
    this.logger.debug("Application close");
    try {
      this.messageBus.send("window.close");
    } catch (error: any) {
      this.logger.error("Unable to close", error);
    }
  }
  exit() {
    this.logger.debug("Application exit");
    try {
      this.messageBus.send("application.exit");
    } catch (error: any) {
      this.logger.error("Unable to exit", error);
    }
  }
  relaunch() {
    this.logger.debug("Application relaunch");
    try {
      this.messageBus.send("application.relaunch");
    } catch (error: any) {
      this.logger.error("Unable to relaunch", error);
    }
  }
  public isNative() {
    return this.getOsType() !== OperatingSystem.Browser && this.getOsType() !== OperatingSystem.Unknown;
  }
  public async withWindowControls() {
    return this.isNative() && [OperatingSystem.Linux, OperatingSystem.Windows].includes(this.getOsType());
  }
  openDevTools() {
    try {
      this.logger.debug("Application openDevTools");
      this.messageBus.send("openDevTools");
    } catch (error: any) {
      this.logger.error("Unable to openDevTools", error);
    }
  }
  async openFileSelector(options: OpenFileSelectorOptions) {
    this.logger.debug("Application openFileSelector", options);
    try {
      const result = await this.messageBus.invoke("openFileSelector", options);
      return result;
    } catch (error: any) {
      this.logger.error("Unable to openFileSelector", error);
    }
  }
  async openTerminal(options: OpenTerminalOptions) {
    this.logger.debug("Application openTerminal", options);
    try {
      const result = await this.messageBus.invoke("openTerminal", options);
      return result;
    } catch (error: any) {
      this.logger.error("Unable to openTerminal", error);
    }
  }

  // logging — the rotating LOCAL log file is owned by main (electron-log adapter); the renderer persists
  // the policy via setGlobalUserSettings, then nudges main to re-apply it / open the file.
  //
  // These failures are reported via the raw console, NEVER this.logger: routing them through the logger
  // would forward them to the file backend and write "couldn't open the log file" INTO the log file (even
  // creating it on a failed read). The logging system must never log about itself into its own sink.
  async applyLogging(): Promise<{ logFile: string }> {
    try {
      return (await this.messageBus.invoke("logging:apply")) as { logFile: string };
    } catch (error: any) {
      console.error("Unable to apply logging", error);
      return { logFile: "" };
    }
  }
  async openLogFile(): Promise<{ ok: boolean; reason?: string }> {
    try {
      return (await this.messageBus.invoke("logging:open")) as { ok: boolean; reason?: string };
    } catch (error: any) {
      console.error("Unable to open log file", error);
      return { ok: false, reason: "error" };
    }
  }
  async revealLogFile(): Promise<{ ok: boolean; reason?: string }> {
    try {
      return (await this.messageBus.invoke("logging:reveal")) as { ok: boolean; reason?: string };
    } catch (error: any) {
      console.error("Unable to reveal log file", error);
      return { ok: false, reason: "error" };
    }
  }
  openStorageFolder() {
    try {
      this.messageBus.send("openStorageFolder");
    } catch (error: any) {
      this.logger.error("Unable to open storage folder", error);
    }
  }
  async applyProxy(proxy?: Partial<ProxyConfig>): Promise<{ ok: boolean; proxy?: ProxyConfig }> {
    try {
      return (await this.messageBus.invoke("proxy.apply", proxy)) as { ok: boolean; proxy?: ProxyConfig };
    } catch (error: any) {
      this.logger.error("Unable to apply proxy", error);
      return { ok: false };
    }
  }
  async testProxyConnectivity(proxy?: Partial<ProxyConfig>): Promise<{
    ok: boolean;
    status?: number;
    url?: string;
    elapsedMs?: number;
    error?: string;
  }> {
    try {
      return (await this.messageBus.invoke("proxy.test", proxy)) as {
        ok: boolean;
        status?: number;
        url?: string;
        elapsedMs?: number;
        error?: string;
      };
    } catch (error: any) {
      this.logger.error("Unable to test proxy connectivity", error);
      return { ok: false, error: error?.message ?? `${error}` };
    }
  }

  // settings

  async setGlobalUserSettings(settings: Partial<GlobalUserSettings>) {
    if (settings?.logging?.level) {
      this.logger.info("Setting preferences log level", settings?.logging?.level);
      this.logLevel = settings?.logging?.level;
      await setLevel(settings?.logging?.level);
    }
    const { proxy, ...rest } = settings;
    const hasProxy = Object.hasOwn(settings, "proxy");
    if (Object.keys(rest).length > 0) {
      await this.userConfiguration.setSettings(rest);
    }
    if (hasProxy) {
      await this.userConfiguration.setProxyConfig(normalizeProxyConfig(proxy));
    }
    return await this.getGlobalUserSettings();
  }

  async getGlobalUserSettings() {
    const settings = {
      theme: normalizeTheme(await this.userConfiguration.getKey<string>("theme", "bp6-dark")),
      engineTheme: normalizeEngineThemePreference(await this.userConfiguration.getKey<string>("engineTheme", "auto")),
      showEngineColumn: await this.userConfiguration.getKey("showEngineColumn", false),
      expandSidebar: await this.userConfiguration.getKey("expandSidebar", true),
      startApi: await this.userConfiguration.getKey("startApi", false),
      minimizeToSystemTray: await this.userConfiguration.getKey("minimizeToSystemTray", false),
      checkLatestVersion: await this.userConfiguration.getKey("checkLatestVersion", false),
      font: await this.userConfiguration.getKey("font", {}),
      path: await this.userConfiguration.getStoragePath(),
      logging: {
        level: await getLevel(),
        // Always populate the file policy with safe defaults so older configs never surface `undefined`
        // to the settings UI or the logging:* IPC (opt-in, OFF by default).
        file: normalizeLoggingFileSettings((await this.userConfiguration.getKey<any>("logging"))?.file),
      },
      connector: isMockMode()
        ? {
            default:
              getMockEngine() === ContainerEngine.DOCKER
                ? MOCK_DOCKER_SYSTEM_ID
                : getMockEngine() === ContainerEngine.APPLE
                  ? MOCK_CONTAINER_SYSTEM_ID
                  : MOCK_PODMAN_SYSTEM_ID,
          }
        : await this.userConfiguration.getKey("connector"),
      connections: await this.getConnectionsFromConfiguration(),
      // Always populate the AI section with safe defaults so older configs (and any partial
      // ai blob) never surface `undefined` to the UI or the ai:* IPC handlers.
      ai: normalizeAISettings(await this.userConfiguration.getKey("ai")),
      proxy: normalizeProxyConfig(await this.userConfiguration.getKey("proxy")),
      // First-run wizard state. Default skipAtStartup:false so a fresh config shows the wizard once
      // (the renderer gates on `skipAtStartup !== true`). Inlined so container-client need not import
      // the higher-level provisioning package.
      wizard: { skipAtStartup: false, ...((await this.userConfiguration.getKey<any>("wizard")) ?? {}) },
    } as GlobalUserSettings;
    return settings;
  }

  async setConnectorSettings(id: string, settings: Partial<EngineConnectorSettings>) {
    await this.userConfiguration.setKey(id, settings);
    return await this.getConnectorSettings(id);
  }

  async getConnectorSettings(id: string) {
    return await this.userConfiguration.getKey<EngineConnectorSettings>(id);
  }

  // Podman specific
  async getPodLogs(id?: any, tail?: any) {
    const currentApi = this.getCurrentEngineConnectionApi<HostClientFacade>();
    return await currentApi.getPodLogs(id, tail);
  }
  async generateKube(entityId?: any) {
    const currentApi = this.getCurrentEngineConnectionApi<HostClientFacade>();
    return await currentApi.generateKube(entityId);
  }
  async getEvents(opts?: SubscriptionOptions) {
    const currentApi = this.getCurrentEngineConnectionApi<HostClientFacade>();
    return await currentApi.getEvents(opts);
  }
  async getPodmanMachineInspect(name: string) {
    const currentApi = this.getCurrentEngineConnectionApi<HostClientFacade>();
    return await currentApi.getPodmanMachineInspect(name);
  }
  async getPodmanMachines(customFormat?: string, customSettings?: EngineConnectorSettings) {
    const currentApi = this.getCurrentEngineConnectionApi<HostClientFacade>();
    return await currentApi.getPodmanMachines(customFormat, customSettings);
  }
  async createPodmanMachine(opts: CreateMachineOptions) {
    const currentApi = this.getCurrentEngineConnectionApi<HostClientFacade>();
    return await currentApi.createPodmanMachine(opts);
  }
  async removePodmanMachine(name: string) {
    const currentApi = this.getCurrentEngineConnectionApi<HostClientFacade>();
    return await currentApi.removePodmanMachine(name);
  }
  async stopPodmanMachine(name: string) {
    const currentApi = this.getCurrentEngineConnectionApi<HostClientFacade>();
    return await currentApi.stopPodmanMachine(name);
  }
  async restartPodmanMachine(name: string) {
    const currentApi = this.getCurrentEngineConnectionApi<HostClientFacade>();
    return await currentApi.restartPodmanMachine(name);
  }
  async connectToPodmanMachine(name: string) {
    const currentApi = this.getCurrentEngineConnectionApi<HostClientFacade>();
    return await currentApi.connectToPodmanMachine(name);
  }

  // Scope actions
  async getControllerScopes(connection: Connection, skipAvailabilityCheck: boolean) {
    const currentApi = await this.getConnectionApi(connection, skipAvailabilityCheck);
    this.logger.debug("Listing controller scopes of current host", connection);
    return await currentApi.getControllerScopes(undefined, skipAvailabilityCheck);
  }

  async startScope(scope: ControllerScope, connection: Connection, skipAvailabilityCheck: boolean) {
    let status = StartupStatus.ERROR;
    const currentApi = await this.getConnectionApi(connection, skipAvailabilityCheck);
    if (currentApi.isScoped()) {
      this.logger.debug(">> Starting scope", scope, "with connection", connection);
      status = await currentApi.startScope(scope);
      this.logger.debug("<< Starting scope", scope, "with connection", status, connection);
    }
    return status;
  }

  async stopScope(scope: ControllerScope, connection: Connection, skipAvailabilityCheck: boolean) {
    let flag = false;
    const currentApi = await this.getConnectionApi(connection, skipAvailabilityCheck);
    if (currentApi.isScoped()) {
      this.logger.debug("Stopping scope", scope, "with connection", connection, currentApi);
      flag = await currentApi.stopScope(scope);
    }
    return flag;
  }

  // System actions
  async connectToContainer(opts: ContainerConnectOptions & { host?: HostClientFacade }) {
    const { id, title, shell } = opts || {};
    this.logger.debug("Connecting to container", opts);
    const currentApi = opts.host || this.getCurrentEngineConnectionApi();
    if (!currentApi) {
      throw new Error("No active engine connection");
    }
    const { program, controller } = await currentApi.getSettings();
    let launcherPath = "";
    const containerArgs: string[] = [];
    if (currentApi.isScoped()) {
      const scope = controller?.scope || "";
      const isLIMA = [
        ContainerEngineHost.PODMAN_VIRTUALIZED_LIMA,
        ContainerEngineHost.DOCKER_VIRTUALIZED_LIMA,
      ].includes(currentApi.HOST);
      const isWSL = [ContainerEngineHost.PODMAN_VIRTUALIZED_WSL, ContainerEngineHost.DOCKER_VIRTUALIZED_WSL].includes(
        currentApi.HOST,
      );
      const isVendor = [ContainerEngineHost.PODMAN_VIRTUALIZED_VENDOR].includes(currentApi.HOST);
      if (isLIMA) {
        containerArgs.push("shell");
        containerArgs.push(scope);
      }
      if (isWSL) {
        containerArgs.push("--distribution");
        containerArgs.push(scope);
        containerArgs.push("--exec");
      }
      if (isVendor) {
        containerArgs.push("machine");
        containerArgs.push("ssh");
        containerArgs.push(scope);
      }
      launcherPath = controller?.path || controller?.name || "";
      containerArgs.push(program.path || program.name);
    } else {
      launcherPath = program.path || program.name;
    }
    containerArgs.push(...["exec", "-it", id, shell || "/bin/sh"]);
    const output = await Platform.launchTerminal(launcherPath, containerArgs, {
      title: title || `${currentApi.ENGINE} container`,
    });
    if (!output.success) {
      this.logger.error("Unable to connect to container", id, output);
    }
    return output.success;
  }

  async findProgram(connection: Connection, program: Program, insideScope?: boolean) {
    const api = await this.getConnectionApi(connection, false);
    let outputProgram: Program = {
      ...program,
      path: "",
    };
    this.logger.debug(connection.id, ">> Find program", insideScope ? "inside" : "outside", "scope", {
      connector: deepMerge({}, connection),
      program: outputProgram,
    });
    if (insideScope) {
      outputProgram = await api.findScopeProgram(outputProgram);
    } else {
      outputProgram = await api.findHostProgram(program);
    }
    this.logger.debug(connection.id, "<< Find program", insideScope ? "inside" : "outside", "scope", outputProgram);
    return outputProgram;
  }

  async findProgramVersion(connection: Connection, program: Program, insideScope?: boolean) {
    const api = await this.getConnectionApi(connection, false);
    let version = "";
    this.logger.debug(connection.id, ">> Find program version", insideScope ? "inside" : "outside", "scope", {
      connector: deepMerge({}, connection),
      program,
    });
    if (insideScope) {
      version = await api.findScopeProgramVersion(program);
    } else {
      version = await api.findHostProgramVersion(program);
    }
    this.logger.debug(connection.id, "<< Find program version", insideScope ? "inside" : "outside", "scope", version, {
      connector: deepMerge({}, connection),
      program,
    });
    return version;
  }

  // Connection
  async getConnectionsFromConfiguration() {
    if (isMockMode()) {
      return buildMockConnections();
    }
    let connections = await this.userConfiguration.getKey<Connection[]>("connections", []);
    if (connections.length) {
      // Backwards compatibility checks
      const it = connections[0] as any;
      if (it.runtime) {
        connections = connections.map((it: any) => {
          // Normalize the older field layout (runtime/engine → engine/host)
          const host = it.engine;
          const engine = it.runtime;
          it.engine = engine;
          it.host = host;
          it.runtime = undefined;
          delete it.runtime;
          return it;
        });
        // Persist the normalized connections
        await this.userConfiguration.setKey("connections", connections);
        this.logger.warn("Migrated connections to new format", connections);
      }
    }
    return connections;
  }

  async createConnection(connection: Connection) {
    this.logger.debug("Create connection", connection);
    let connections: Connection[] = await this.getConnectionsFromConfiguration();
    if (!connections) {
      connections = [];
    }
    connections.push({
      id: connection.id,
      name: connection.name,
      label: connection.label,
      host: connection.host,
      engine: connection.engine,
      settings: connection.settings,
    });
    await this.userConfiguration.setKey("connections", connections);
    return connection;
  }

  async updateConnection(id: string, connection: Partial<Connection>) {
    const connections: Connection[] = await this.getConnectionsFromConfiguration();
    const updated = connections.findIndex((it) => it.id === id);
    if (updated !== -1) {
      connections[updated] = deepMerge({}, connections[updated], connection);
      await this.userConfiguration.setKey("connections", connections);
    }
    return connection as Connection;
  }

  async removeConnection(id: string) {
    try {
      this.logger.debug("Removing connection", id);
      let connections: Connection[] = await this.getConnectionsFromConfiguration();
      connections = connections.filter((it) => it.id !== id);
      await this.userConfiguration.setKey("connections", connections);
    } catch (error: any) {
      this.logger.error("Unable to remove connection", error.message);
      return false;
    }
    return true;
  }

  async getConnections() {
    const connections: Connection[] = await this.getConnectionsFromConfiguration();
    return connections || [];
  }

  async getSystemConnections() {
    if (isMockMode()) {
      return [];
    }
    const connections: Connection[] = [];
    // Add system podman as default
    const firstPodman: Connection = getDefaultConnectors(this.osType).find(
      (it) => it.engine === ContainerEngine.PODMAN && it.availability.enabled,
    ) as Connection;
    if (firstPodman) {
      firstPodman.id = "system-default.podman";
      firstPodman.description = "Uses the available system podman installation";
      firstPodman.name = "System Podman";
      firstPodman.readonly = true;
      firstPodman.settings.api.autoStart = true;
      firstPodman.settings.mode = "mode.automatic";
      connections.push(firstPodman);
    }
    // Add system docker as default
    const firstDocker: Connection = getDefaultConnectors(this.osType).find(
      (it) => it.engine === ContainerEngine.DOCKER && it.availability.enabled,
    ) as Connection;
    if (firstDocker) {
      firstDocker.id = "system-default.docker";
      firstDocker.description = "Uses the available system docker installation";
      firstDocker.name = "System Docker";
      firstDocker.readonly = true;
      firstDocker.settings.api.autoStart = true;
      firstDocker.settings.mode = "mode.automatic";
      connections.push(firstDocker);
    }
    // Add system Apple containers as default (macOS only - Apple's native `container` runtime)
    if (this.osType === OperatingSystem.MacOS) {
      const firstApple: Connection = getDefaultConnectors(this.osType).find(
        (it) => it.engine === ContainerEngine.APPLE && it.availability.enabled,
      ) as Connection;
      if (firstApple) {
        firstApple.id = "system-default.container";
        firstApple.description = "Uses the available system Apple container installation";
        firstApple.name = "System Containers";
        firstApple.readonly = true;
        firstApple.settings.api.autoStart = true;
        firstApple.settings.mode = "mode.automatic";
        connections.push(firstApple);
      }
    }
    // Dev-only: seed env-driven remote connections (CONTAINER_DESKTOP_REMOTE_*). Readonly and regenerated
    // each run, so they appear and auto-start without ever being persisted to user-settings.json.
    connections.push(...buildRemoteConnectionsFromEnv(resolveRemoteEnvConnections(), this.osType));
    return connections || [];
  }

  async getConnectionDataDir(connection: Connection) {
    const host = await this.getConnectionApi(connection, false);
    return await host.getConnectionDataDir();
  }

  // System

  async getSystemInfo(connection?: Connection, customFormat?: string, customSettings?: EngineConnectorSettings) {
    let currentApi = this._currentContainerEngineHostClient;
    if (connection) {
      currentApi = await this.getConnectionApi(connection, false);
    }
    return await currentApi.getSystemInfo(connection, customFormat, customSettings);
  }

  async pruneSystem(opts?: any) {
    const currentApi = this.getCurrentEngineConnectionApi();
    return await currentApi.pruneSystem(opts);
  }

  async resetSystem() {
    const currentApi = this.getCurrentEngineConnectionApi();
    return await currentApi.resetSystem();
  }

  async checkSecurity(options: { scanner: string; subject: string; target: string; host?: HostClientFacade }) {
    const currentApi = options.host || this.getCurrentEngineConnectionApi();
    const report: any = createSecurityReport(options.scanner);
    try {
      if (!currentApi) {
        throw new Error("No active engine connection");
      }
      let program: Program;
      const scanner = options?.scanner || "trivy";
      const settings = await currentApi.getSettings();
      const scope = settings.controller?.scope || "";
      const useScope =
        currentApi.isScoped() &&
        ![ContainerEngineHost.PODMAN_VIRTUALIZED_VENDOR, ContainerEngineHost.DOCKER_VIRTUALIZED_VENDOR].includes(
          currentApi.HOST,
        );
      if (useScope) {
        program = await currentApi.findScopeProgram({
          name: options.scanner,
          path: "",
        });
      } else {
        program = await currentApi.findHostProgram({
          name: options.scanner,
          path: "",
        });
      }
      // Only the DETECTED path — never fall back to the bare scanner name. When the scanner is not installed
      // detection yields an empty path; fabricating one here made the app run a missing binary and, because
      // report.scanner.path was truthy, made the UI show "internal error, please report" instead of the correct
      // "please install trivy" guidance.
      const programPath = program?.path || "";
      // support only trivy for now
      if (programPath) {
        report.scanner.path = programPath;
        report.scanner.name = options.scanner;
        report.scanner.version = program?.version || "";
        report.scanner.database = {}; // TODO: get database info

        let result: CommandExecutionResult;
        if (useScope) {
          result = await currentApi.runScopeCommand(programPath, ["--version", "--format", "json"], scope);
        } else {
          result = await currentApi.runHostCommand(programPath, ["--version", "--format", "json"]);
        }
        // Parse database version
        try {
          const { database, version } = parseTrivyDatabase(result.stdout);
          report.scanner.database = database;
          report.scanner.version = version;
        } catch (error: any) {
          this.logger.error("Unable to decode trivy database", error);
        }

        if (result.success) {
          // Scanner analysis
          try {
            let analysis: CommandExecutionResult;
            if (useScope) {
              analysis = await currentApi.runScopeCommand(
                programPath,
                ["--quiet", options.subject, "--format", "json", options.target],
                scope,
              );
            } else {
              analysis = await currentApi.runHostCommand(programPath, [
                "--quiet",
                options.subject,
                "--format",
                "json",
                options.target,
              ]);
            }
            if (analysis?.success && analysis.stdout !== "null") {
              try {
                report.result = parseTrivyAnalysis(analysis.stdout, report.counts);
                report.status = "success";
              } catch (error: any) {
                this.logger.error("Error during output parsing", error.message, analysis);
                report.fault = {
                  detail: "Error during output parsing",
                  message: error.message,
                };
              }
            } else {
              this.logger.error("Analysis failed", analysis);
              report.fault = {
                detail: "Analysis failed",
                message: report.stderr,
              };
            }
          } catch (error: any) {
            this.logger.error("Error during scanning process", error.message);
            report.fault = {
              detail: "Error during scanning process",
              message: error.message,
            };
          }
        }
      } else {
        this.logger.debug(`Security scanner '${scanner}' is not installed - reporting as unavailable`);
      }
    } catch (error: any) {
      this.logger.error("Error during scanner detection", error.message);
      report.fault = {
        detail: "Error during scanner detection",
        message: error.message,
      };
    }
    return report;
  }

  // registry
  async getRegistriesMap(opts?: { host?: HostClientFacade }): Promise<RegistriesMap> {
    // Mock mode: serve generated registries. loadEngineFixtures is the production-gated loader, so the
    // generator (and @faker-js/faker) is still tree-shaken out of shipped builds; isMockMode() is also a
    // no-op in production, making this branch doubly dead there.
    if (isMockMode()) {
      const engine = opts?.host?.ENGINE ?? getMockEngine();
      return (await loadEngineFixtures(engine)).registries;
    }
    // In the always-merged workspace connectAll never sets the singular _currentContainerEngineHostClient
    // (it caches per-connection hosts only), so callers pass the row's host explicitly. Optional-chain the
    // engine so a missing host degrades to "not podman" (system registry hidden) instead of throwing.
    const host = opts?.host || (this._currentContainerEngineHostClient as HostClientFacade | undefined);
    const isPodman = host?.ENGINE === ContainerEngine.PODMAN;
    const customRegistriesPath = await Path.join(await this.userConfiguration.getStoragePath(), "registries.json");
    const registriesMap = {
      default: AUTOMATIC_REGISTRIES.map((it) => (it.id === "system" && !isPodman ? { ...it, enabled: false } : it)),
      custom: PROPOSED_REGISTRIES,
    };
    if (await FS.isFilePresent(customRegistriesPath)) {
      const custom = JSON.parse(await FS.readTextFile(customRegistriesPath));
      if (custom.length) {
        registriesMap.custom = custom;
      }
    }
    return registriesMap;
  }

  async setRegistriesMap(registries: RegistriesMap, opts?: { host?: HostClientFacade }) {
    const customRegistriesPath = await Path.join(await this.userConfiguration.getStoragePath(), "registries.json");
    await FS.writeTextFile(customRegistriesPath, JSON.stringify(registries.custom));
    return await this.getRegistriesMap(opts);
  }

  async searchRegistry(opts: RegistrySearchOptions & { host?: HostClientFacade }) {
    const { filters, term, registry } = opts || {};
    this.logger.debug("searchRegistry", { filters, term, registry });
    let items = [];
    const host = opts.host || (this._currentContainerEngineHostClient as HostClientFacade);
    if (!host) {
      throw new Error("No active engine connection");
    }
    const { program } = await host.getSettings();
    let programArgs: string[] = ["search"];
    const isPodman = host.ENGINE === ContainerEngine.PODMAN;
    const isDocker = host.ENGINE === ContainerEngine.DOCKER;
    const isApple = host.ENGINE === ContainerEngine.APPLE;
    if (isPodman) {
      // Search using API
      if (registry?.id === "system") {
        const driver = await host.getApiDriver();
        const searchParams = buildImageSearchParams(term, filters, { includeAutomated: true });
        const request = {
          method: "GET",
          url: `/images/search?${searchParams.toString()}`,
        };
        this.logger.debug("Proxying request", request);
        const response = await driver.request(request);
        items = response.data || [];
        return normalizeAndSortSearchResults(items);
      }
      // Search using CLI
      programArgs = buildPodmanSearchArgs(registry, term, filters);
    } else if (isDocker) {
      programArgs = buildDockerSearchArgs(term, filters);
    } else if (isApple) {
      // Apple speaks Docker REST via socktainer — use the API search endpoint (like Podman system-API).
      // No `container` CLI search; socktainer /images/search is the single verify-live endpoint.
      const driver = await host.getApiDriver();
      const searchParams = buildImageSearchParams(term, filters, { includeAutomated: false });
      const request = {
        method: "GET",
        url: `/images/search?${searchParams.toString()}`,
      };
      this.logger.debug("Proxying Apple search request", request);
      try {
        const response = await driver.request(request);
        items = response.data || [];
        return normalizeAndSortSearchResults(items);
      } catch {
        // If socktainer 404s /images/search, degrade to no results (not an error).
        return [];
      }
    }
    let result: CommandExecutionResult;
    if (host.isScoped()) {
      const { controller } = await host.getSettings();
      result = await host.runScopeCommand(program.path || program.name, programArgs, controller?.scope || "");
    } else {
      result = await host.runHostCommand(program.path || program.name, programArgs);
    }
    if (!result.success) {
      this.logger.error("Unable to search", { term, registry }, result);
    } else {
      try {
        // Docker outputs multiple JSON lines - not an array of objects
        const output = normalizeSearchOutput(result.stdout, isDocker);
        if (output) {
          items = JSON.parse(output);
        } else {
          this.logger.warn("Empty output", result);
        }
      } catch (error: any) {
        this.logger.error("Search results parsing error", error.message, error.stack);
      }
    }
    return normalizeAndSortSearchResults(items);
  }

  async pullFromRegistry(opts: RegistryPullOptions & { host?: HostClientFacade }) {
    const { image } = opts;
    this.logger.debug("pull from registry", image);
    const host = opts.host || (this._currentContainerEngineHostClient as HostClientFacade);
    if (!host) {
      throw new Error("No active engine connection");
    }
    const { program, controller } = await host.getSettings();
    let result: CommandExecutionResult;
    if (host.isScoped()) {
      result = await host.runScopeCommand(
        program.path || program.name,
        ["image", "pull", image],
        controller?.scope || "",
      );
    } else {
      result = await host.runHostCommand(program.path || program.name, ["image", "pull", image]);
    }
    return result;
  }

  // Main
  async getConnectionApi<T extends HostClientFacade = HostClientFacade>(
    connection: Connection,
    skipAvailabilityCheck: boolean,
  ) {
    if (this.connectionApis[connection.id]) {
      this.logger.debug("Using connection api - found", connection.id);
      this.connectionApis[connection.id].setSettings(connection.settings);
    } else {
      this.logger.debug("Using connection api - creating", connection.id);
      const connector = deepMerge<Connector>(
        {},
        createConnectorBy(this.osType, connection.engine, connection.host),
        connection,
      );
      try {
        const { host, availability } = await this.createConnectorContainerEngineHostClient(connector, {
          connection: connector,
          startApi: false,
          skipAvailabilityCheck,
        });
        connector.availability = availability;
        if (host) {
          this.connectionApis[connection.id] = host;
        } else {
          this.logger.error("Unable to create connection api", connector.id);
        }
      } catch (error: any) {
        this.logger.error("Unable to create connection api", connector.id, error.message, error.stack);
      }
    }
    return this.connectionApis[connection.id] as T;
  }

  getCurrentEngineConnectionApi<T extends HostClientFacade = HostClientFacade>() {
    return this._currentContainerEngineHostClient as T;
  }

  // Per-connection host lookup over the cache getConnectionApi() populates — lets main (and the command
  // proxy) serve several connections at once by id, instead of the single _currentContainerEngineHostClient.
  getHostClientFor<T extends HostClientFacade = HostClientFacade>(connectionId: string): T | undefined {
    return this.connectionApis[connectionId] as T | undefined;
  }

  // Build a host for a specific connection and cache it by id, WITHOUT mutating the singular
  // _currentContainerEngineHostClient — so several connections can be brought up in parallel (connectAll)
  // without racing on a shared "current". Returns the host + its availability for the caller's runtime state.
  async connectHostClient(
    connection: Connection,
    opts?: { startApi?: boolean; skipAvailabilityCheck?: boolean },
  ): Promise<{ host?: HostClientFacade; availability?: EngineConnectorAvailability }> {
    const connector = deepMerge<Connector>(
      {},
      await createConnectorBy(this.osType, connection.engine, connection.host, connection.id),
      connection,
    );
    connector.connectionId = connection.id;
    connector.settings = deepMerge({}, connection.settings);
    connector.logLevel = this.logLevel;
    const { host, availability } = await this.createConnectorContainerEngineHostClient(connector, {
      connection: connector,
      startApi: opts?.startApi ?? false,
      skipAvailabilityCheck: opts?.skipAvailabilityCheck ?? false,
      origin: "connectHostClient",
    });
    if (host) {
      this.connectionApis[connection.id] = host;
    }
    return { host, availability };
  }

  protected startupStatus: StartupStatus = StartupStatus.STOPPED;

  // Remote SSH hosts need a LOCAL forward-socket address for the `ssh -NL local:remote` tunnel; automatic
  // detection leaves it empty on Linux/macOS (the engine socket is remote, resolveScopeURI returns ""), so
  // derive a stable local endpoint. Shared by start() and the connect/autostart path so both behave the
  // same — otherwise the latter fails with "Local address not provided".
  protected async ensureRemoteForwardAddress(connection: Connection, settings: EngineConnectorSettings): Promise<void> {
    if (settings.api?.connection?.uri) {
      return;
    }
    if (
      connection.host !== ContainerEngineHost.PODMAN_REMOTE &&
      connection.host !== ContainerEngineHost.DOCKER_REMOTE &&
      connection.host !== ContainerEngineHost.APPLE_REMOTE
    ) {
      return;
    }
    // A Unix-domain socket path is capped at ~104 bytes; a long connection id (host.<uuid>.docker.remote)
    // overflows it → listen EINVAL. Hash the id to a short, stable filename. Windows named pipes have no such
    // limit, so they keep the full, readable id.
    settings.api.connection.uri =
      this.osType === OperatingSystem.Windows
        ? getWindowsPipePath(connection.id)
        : await Path.join(await Platform.getUserDataPath(), `cdt-ssh-${shortStableHash(connection.id)}.sock`);
  }

  async createConnectorContainerEngineHostClient(
    connector: Connector,
    opts?: ConnectOptions,
  ): Promise<{
    host: HostClientFacade | undefined;
    availability: EngineConnectorAvailability;
  }> {
    this.logger.debug(connector.id, ">> Creating connector host api", opts);
    const startApi = opts?.startApi ?? false;
    let host: HostClientFacade | undefined;
    let availability = connector.availability;
    try {
      host = await createComposedHostClient(connector, this.osType);
      systemNotifier.transmit("startup.phase", {
        trace: "Engine host created",
      });
      if (!host) {
        this.logger.error(connector.id, "Connector host not found", connector.host);
        throw new Error("Connector host not found");
      }
      if (host) {
        const settings = opts?.connection?.settings || connector.settings;
        this.logger.debug(connector.id, "Using custom host - settings", {
          user: opts?.connection?.settings,
          defaults: connector.settings,
          settings: settings,
        });
        // Ensure remote SSH hosts have a local forward-socket address BEFORE detection — automatic settings
        // preserve a pre-set uri (sshApiConnection falls back to it) but leave it empty otherwise, which
        // would later fail the tunnel with "Local address not provided".
        await this.ensureRemoteForwardAddress(connector, settings);
        host.setLogLevel(this.logLevel);
        await host.setSettings(settings);
        if (isMockMode()) {
          return { host, availability: mockAvailability() };
        }
        if (settings.mode === "mode.automatic") {
          const scope = settings.controller?.scope || "";
          if (opts?.skipAvailabilityCheck) {
            this.logger.debug(connector.id, "Skipping automatic settings - availability check disabled");
          } else {
            systemNotifier.transmit("startup.phase", {
              trace: "Performing automatic connection detection",
            });
            if (host.isScoped()) {
              if (this.startupStatus === StartupStatus.STARTED) {
                systemNotifier.transmit("startup.phase", {
                  trace: `Stopping ${scope}`,
                });
                await host.stopScopeByName(scope);
              }
              systemNotifier.transmit("startup.phase", {
                trace: `Starting ${scope}`,
              });
              this.startupStatus = await host.startScopeByName(scope);
            }
            const automaticSettings = await host.getAutomaticSettings();
            this.logger.debug(connector.id, "Using automatic settings", {
              api: {
                baseURL: automaticSettings.api.baseURL,
                uri: automaticSettings.api.connection.uri,
                relay: automaticSettings.api.connection.relay,
              },
              controller: automaticSettings.controller
                ? {
                    name: automaticSettings.controller.name,
                    path: automaticSettings.controller.path,
                    scope: automaticSettings.controller.scope,
                    version: automaticSettings.controller.version,
                  }
                : undefined,
              engine: connector.engine,
              host: connector.host,
              mode: automaticSettings.mode,
              program: {
                name: automaticSettings.program.name,
                path: automaticSettings.program.path,
                version: automaticSettings.program.version,
              },
            });
            await host.setSettings(automaticSettings);
          }
        }
        if (startApi) {
          systemNotifier.transmit("startup.phase", {
            trace: "Starting connection api",
          });
          try {
            await host.startApi(undefined, { logLevel: this.logLevel });
          } catch (error: any) {
            this.logger.error(connector.id, "Unable to start the host API", error);
          }
        } else {
          this.logger.debug(connector.id, "Skipping host API start - not marked for start");
        }
        // Read availability
        this.logger.debug(connector.id, ">> Reading host availability");
        try {
          if (opts?.skipAvailabilityCheck) {
            this.logger.debug(connector.id, "Skipping availability check");
          } else {
            systemNotifier.transmit("startup.phase", {
              trace: "Performing availability checks",
            });
            availability = await host.getAvailability(connector.settings);
            systemNotifier.transmit("startup.phase", {
              trace: "Availability checks completed",
            });
            if (!availability.api) {
              this.logger.warn(connector.id, "Connector host api is not available - cleaning up");
              try {
                await host.stopApi();
              } catch (error: any) {
                this.logger.error(connector.id, "Connector host api stop error", error);
              }
            }
          }
        } catch (error: any) {
          this.logger.error(connector.id, "<< Reading host availability failed", error);
        }
        this.logger.debug(connector.id, "<< Reading host availability", availability);
      }
    } catch (error: any) {
      this.logger.error(connector.id, "Connector host api creation error", error);
      // Don't let a real failure (e.g. "ssh: … No route to host") leak out as the "Not checked" placeholder:
      // fold the actual reason + its raw detail (SSH preflight steps / stack) into availability so the whole
      // chain — connectOne → progress → Activity Center — can show WHY, never a terse nothing.
      const reason = `${error?.message ?? error}`.trim() || "Engine connection failed";
      if (availability) {
        availability = {
          ...availability,
          api: false,
          report: { ...availability.report, api: reason, detail: describeConnectError(error) },
        };
      }
    }
    this.logger.debug(connector.id, "<< Creating connector host api", {
      host,
      availability,
    });
    return { host, availability };
  }

  async init() {
    // All logic is done only once at application startup - can be updated during host changes by the start logic
    if (this.inited) {
      this.logger.debug("Init skipping - already initialized");
      return this.inited;
    }
    this.logger.debug("Creating application bridge");
    try {
      this.connectors = getDefaultConnectors(this.osType);
      this.connectors.forEach((connector) => {
        connector.logLevel = this.logLevel;
      });
    } catch (error: any) {
      this.logger.error("Init - Unable to initialize application runtimes", error.message, error.stack);
    }
    this.inited = true;
    return this.inited;
  }

  async stop(opts?: DisconnectOptions): Promise<boolean> {
    const host = this._currentContainerEngineHostClient as HostClientFacade;
    if (host) {
      this.logger.debug(">> Bridge stop start", opts, host.id);
      const stopped = await host.stopApi();
      this.logger.debug(">> Bridge stop completed", opts, host.id, { stopped });
    } else {
      this.logger.debug("<< Bridge stop skipped - not started", opts);
    }
    return false;
  }

  async start(opts?: ConnectOptions): Promise<Connector | undefined> {
    this.logger.debug("Bridge startup - begin", opts);
    let connector: Connector | undefined;
    try {
      this.logger.debug("Bridge startup - creating current");
      const currentOpts = deepMerge({}, opts || {});
      if (opts?.connection) {
        systemNotifier.transmit("startup.phase", {
          trace: "Creating connectors",
        });
        connector = await createConnectorBy(
          this.osType,
          opts.connection.engine,
          opts.connection.host,
          opts.connection.id,
        );
        connector.connectionId = opts.connection.id;
        connector.name = opts.connection.name;
        connector.label = opts.connection.label;
        connector.disabled = opts.connection.disabled ?? false;
        connector.settings = deepMerge({}, opts.connection.settings);
        connector.logLevel = this.logLevel;
        currentOpts.connection.settings = connector.settings;
        await this.ensureRemoteForwardAddress(connector, connector.settings);
        if (!connector) {
          this.logger.error("Bridge startup - no connector found", currentOpts);
          throw new Error("No connector found");
        }
        systemNotifier.transmit("startup.phase", {
          trace: "Creating connector host starting",
        });
        const { host, availability } = await this.createConnectorContainerEngineHostClient(connector, {
          ...currentOpts,
          origin: "start",
        });
        if (host) {
          const engineSettings = await host.getSettings();
          connector.settings = deepMerge(connector.settings, engineSettings);
          connector.availability = availability;
          connector.capabilities = host.capabilities;
          this._currentContainerEngineHostClient = host;
          this.logger.debug("Host settings resolved", {
            id: connector.id,
            engine: connector.engine,
            host: connector.host,
          });
          systemNotifier.transmit("startup.phase", {
            trace: "Creating connector host completed",
          });
        } else {
          throw new Error("Unable to create current host connection");
        }
      }
    } catch (error: any) {
      this.logger.error("Bridge startup error", error);
    }
    return connector;
  }

  async setup() {
    this.logger = createLogger("bridge.application");
    this.inited = await this.init();
    return { logger: this.logger };
  }
}
