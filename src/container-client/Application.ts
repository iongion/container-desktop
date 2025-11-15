import * as async from "async";
import { v4 } from "uuid";

import {
  type AbstractContainerEngineHostClient,
  createConnectorBy,
  Docker,
  getDefaultConnectors,
  Podman,
  RUNTIMES,
} from "@/container-client";
import { UserConfiguration } from "@/container-client/config";
import { systemNotifier } from "@/container-client/notifier";
import type { AbstractEngine, ContainerEngineHostClient } from "@/container-client/runtimes/abstract/base";
import type {
  PodmanAbstractContainerEngineHostClient,
  PodmanContainerEngineHostClientCommon,
} from "@/container-client/runtimes/podman/base";
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
  type Registry,
  type RegistryPullOptions,
  type RegistrySearchOptions,
  StartupStatus,
  type SubscriptionOptions,
} from "@/env/Types";
import { createLogger, getLevel, setLevel } from "@/logger";
import { getWindowsPipePath } from "@/platform";
import { deepMerge } from "@/utils";

const AUTOMATIC_REGISTRIES: Registry[] = [
  {
    id: "system",
    name: "Configuration",
    created: new Date().toISOString(),
    weight: -1,
    isRemovable: false,
    isSystem: true,
    enabled: true,
    engine: [Podman.Engine.ENGINE, Docker.Engine.ENGINE],
  },
];
const PROPOSED_REGISTRIES = [
  {
    id: "quay.io",
    name: "quay.io",
    created: new Date().toISOString(),
    weight: 0,
    isRemovable: true,
    isSystem: false,
    enabled: true,
    engine: [Podman.Engine.ENGINE],
  },
  {
    id: "docker.io",
    name: "docker.io",
    created: new Date().toISOString(),
    weight: 1000,
    isRemovable: true,
    isSystem: false,
    enabled: true,
    engine: [Podman.Engine.ENGINE, Docker.Engine.ENGINE],
  },
];

export const coerceAndSortSearchResults = (items: any[]) => {
  let output = items.map((it) => {
    if (typeof it.Stars === "undefined") {
      it.Stars = 0;
      if (typeof it.StarCount !== "undefined") {
        it.Stars = Number(it.StarCount);
      }
    }
    return it;
  });
  // 1st sort by name
  output = output.sort((a, b) => {
    return a.Name.localeCompare(b.Name, "en", { numeric: true });
  });
  // 2nd sort by stars
  output = output.sort((a, b) => {
    return b.Stars - a.Stars;
  });
  return output;
};

export function detectOperatingSystem() {
  let OSName = "Unknown OS";
  if (navigator.userAgent.indexOf("Win") !== -1) OSName = "Windows";
  if (navigator.userAgent.indexOf("Mac") !== -1) OSName = "MacOS";
  if (navigator.userAgent.indexOf("X11") !== -1) OSName = "UNIX";
  if (navigator.userAgent.indexOf("Linux") !== -1) OSName = "Linux";
  switch (OSName) {
    case "Windows":
      return OperatingSystem.Windows;
    case "MacOS":
      return OperatingSystem.MacOS;
    case "Linux":
    case "Unix":
      return OperatingSystem.Linux;
    default:
      return OperatingSystem.Unknown;
  }
}

export class Application {
  private static instance: Application;

  protected logLevel = "debug";
  protected logger!: ILogger;
  protected messageBus!: IMessageBus;
  protected userConfiguration!: UserConfiguration;
  protected osType: OperatingSystem;
  protected version: string;
  protected environment: string;
  protected connectionApis: {
    [key: string]: AbstractContainerEngineHostClient;
  } = {};
  protected inited = false;
  protected runtimes: AbstractEngine[] = [];
  protected connectors: Connector[] = [];

  protected _currentContainerEngineHostClient!: ContainerEngineHostClient;

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

  setLogLevel(level: string) {
    console.debug("Setting application log level", level);
    try {
      const currentApi = this.getCurrentEngineConnectionApi<PodmanContainerEngineHostClientCommon>();
      if (currentApi) {
        currentApi.setLogLevel(level);
      }
    } catch (error: any) {
      console.error("Unable to set log level", error);
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
    return CURRENT_OS_TYPE !== OperatingSystem.Browser && CURRENT_OS_TYPE !== OperatingSystem.Unknown;
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

  // settings

  async setGlobalUserSettings(settings: Partial<GlobalUserSettings>) {
    if (settings?.logging?.level) {
      this.logger.info("Setting preferences log level", settings?.logging?.level);
      this.logLevel = settings?.logging?.level;
      await setLevel(settings?.logging?.level);
    }
    await this.userConfiguration.setSettings(settings);
    return await this.getGlobalUserSettings();
  }

  async getGlobalUserSettings() {
    // const version = await this.userConfiguration.getKey<string>("version", "");
    const settings = {
      theme: await this.userConfiguration.getKey("theme", "bp5-dark"),
      expandSidebar: await this.userConfiguration.getKey("expandSidebar", true),
      startApi: await this.userConfiguration.getKey("startApi", false),
      minimizeToSystemTray: await this.userConfiguration.getKey("minimizeToSystemTray", false),
      checkLatestVersion: await this.userConfiguration.getKey("checkLatestVersion", false),
      path: await await this.userConfiguration.getStoragePath(),
      logging: {
        level: await getLevel(),
      },
      connector: await this.userConfiguration.getKey("connector"),
      connections: await this.getConnectionsFromConfiguration(),
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

  // Shared
  subscribeToEvents(opts?: SubscriptionOptions) {
    const currentApi = this.getCurrentEngineConnectionApi();
    const subscribe = async () => {
      console.debug(">>>>>>>> EVENTS STREAM REQUESTED");
      const stream = await currentApi.getEventsStream(opts);
      if (stream) {
        console.debug(">>>>>>>> EVENTS STREAM RECEIVED", stream);
      } else {
        console.error(">>>>>>>> EVENTS STREAM FAILED");
      }
    };
    subscribe();
    return {
      subscribe,
      unsubscribe: () => { },
    };
  }

  // Podman specific
  async getPodLogs(id?: any, tail?: any) {
    const currentApi = this.getCurrentEngineConnectionApi<PodmanContainerEngineHostClientCommon>();
    return await currentApi.getPodLogs(id, tail);
  }
  async generateKube(entityId?: any) {
    const currentApi = this.getCurrentEngineConnectionApi<PodmanContainerEngineHostClientCommon>();
    return await currentApi.generateKube(entityId);
  }
  async getEvents(opts?: SubscriptionOptions) {
    const currentApi = this.getCurrentEngineConnectionApi<ContainerEngineHostClient>();
    return await currentApi.getEvents(opts);
  }
  async getPodmanMachineInspect(name: string) {
    const currentApi = this.getCurrentEngineConnectionApi<PodmanAbstractContainerEngineHostClient>();
    return await currentApi.getPodmanMachineInspect(name);
  }
  async getPodmanMachines(customFormat?: string, customSettings?: EngineConnectorSettings) {
    const currentApi = this.getCurrentEngineConnectionApi<PodmanAbstractContainerEngineHostClient>();
    return await currentApi.getPodmanMachines(customFormat, customSettings);
  }
  async createPodmanMachine(opts: CreateMachineOptions) {
    const currentApi = this.getCurrentEngineConnectionApi<PodmanAbstractContainerEngineHostClient>();
    return await currentApi.createPodmanMachine(opts);
  }
  async removePodmanMachine(name: string) {
    const currentApi = this.getCurrentEngineConnectionApi<PodmanAbstractContainerEngineHostClient>();
    return await currentApi.removePodmanMachine(name);
  }
  async stopPodmanMachine(name: string) {
    const currentApi = this.getCurrentEngineConnectionApi<PodmanAbstractContainerEngineHostClient>();
    return await currentApi.stopPodmanMachine(name);
  }
  async restartPodmanMachine(name: string) {
    const currentApi = this.getCurrentEngineConnectionApi<PodmanAbstractContainerEngineHostClient>();
    return await currentApi.restartPodmanMachine(name);
  }
  async connectToPodmanMachine(name: string) {
    const currentApi = this.getCurrentEngineConnectionApi<PodmanAbstractContainerEngineHostClient>();
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
  async connectToContainer(opts: ContainerConnectOptions) {
    const { id, title, shell } = opts || {};
    this.logger.debug("Connecting to container", opts);
    const currentApi = this.getCurrentEngineConnectionApi();
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
    let connections = await this.userConfiguration.getKey<Connection[]>("connections", []);
    if (connections.length) {
      // Backwards compatibility checks
      const it = connections[0] as any;
      if (it.runtime) {
        connections = connections.map((it: any) => {
          // Migrate to new format
          const host = it.engine;
          const engine = it.runtime;
          it.engine = engine;
          it.host = host;
          it.runtime = undefined;
          delete it.runtime;
          return it;
        });
        // Save the new format
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

  async checkSecurity(options: { scanner: string; subject: string; target: string }) {
    const currentApi = this.getCurrentEngineConnectionApi();
    const report: any = {
      status: "failure",
      scanner: {
        name: options.scanner,
        path: "",
        version: undefined,
        database: undefined,
      },
      counts: {
        CRITICAL: 0,
        HIGH: 0,
        MEDIUM: 0,
        LOW: 0,
      },
      result: undefined,
      fault: undefined,
    };
    try {
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
      const programPath = program?.path || program?.name || scanner;
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
        const parsed = result.stdout || "{}";
        try {
          const decoded = JSON.parse(parsed);
          report.scanner.database = decoded || {};
          report.scanner.version = report.scanner.database.Version || "";
        } catch (error: any) {
          console.error("Unable to decode trivy database", error);
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
              const priorities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
              const sorter = (a, b) => {
                return priorities.indexOf(b.Severity) - priorities.indexOf(a.Severity);
              };
              try {
                const data = JSON.parse(analysis.stdout || JSON.stringify({ Results: [] }));
                data.Results = (data.Results || []).map((it) => {
                  it.guid = v4();
                  it.Vulnerabilities = (it.Vulnerabilities || [])
                    .map((v) => {
                      v.guid = v4();
                      if (typeof report.counts[v.Severity] === "undefined") {
                        report.counts[v.Severity] = 0;
                      }
                      report.counts[v.Severity] += 1;
                      return v;
                    })
                    .sort(sorter);
                  return it;
                });
                report.result = data;
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
  async getRegistriesMap() {
    const host = this._currentContainerEngineHostClient as AbstractContainerEngineHostClient;
    const isPodman = host.ENGINE === Podman.Engine.ENGINE;
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

  async setRegistriesMap(registries: RegistriesMap) {
    const customRegistriesPath = await Path.join(await this.userConfiguration.getStoragePath(), "registries.json");
    await FS.writeTextFile(customRegistriesPath, JSON.stringify(registries.custom));
    return await this.getRegistriesMap();
  }

  async searchRegistry(opts: RegistrySearchOptions) {
    const { filters, term, registry } = opts || {};
    this.logger.debug("searchRegistry", { filters, term, registry });
    let items = [];
    const host = this._currentContainerEngineHostClient as AbstractContainerEngineHostClient;
    const { program } = await host.getSettings();
    const filtersList: any[] = [];
    const programArgs = ["search"];
    const isPodman = host.ENGINE === Podman.Engine.ENGINE;
    const isDocker = host.ENGINE === Docker.Engine.ENGINE;
    if (isPodman) {
      // Search using API
      if (registry?.id === "system") {
        const client = await host.getContainerApiClient();
        const driver = await client.getDriver();
        const searchParams = new URLSearchParams();
        searchParams.set("term", term || "");
        // searchParams.set("listTags", "true");
        if (filters?.isAutomated) {
          searchParams.set("is-automated", "true");
        }
        if (filters?.isOfficial) {
          searchParams.set("is-official", "true");
        }
        const request = {
          method: "GET",
          url: `/images/search?${searchParams.toString()}`,
        };
        this.logger.debug("Proxying request", request);
        const response = await driver.request(request);
        items = response.data || [];
        // logger.debug("Results are", output);
        return coerceAndSortSearchResults(items);
      }
      if (filters?.isOfficial) {
        filtersList.push("--filter=is-official");
      }
      if (filters?.isAutomated) {
        filtersList.push("--filter=is-automated");
      }
      // Search using CLI
      programArgs.push(...filtersList);
      programArgs.push(...[`${registry.name}/${term}`, "--format", "json"]);
    } else if (isDocker) {
      programArgs.push("--format", "json");
      if (filters?.isOfficial) {
        filtersList.push("--filter", "is-official=true");
      }
      programArgs.push(...filtersList);
      programArgs.push(...[term]);
    }
    const currentApi = this.getCurrentEngineConnectionApi();
    let result: CommandExecutionResult;
    if (currentApi.isScoped()) {
      const { controller } = await currentApi.getSettings();
      result = await currentApi.runScopeCommand(program.path || program.name, programArgs, controller?.scope || "");
    } else {
      result = await currentApi.runHostCommand(program.path || program.name, programArgs);
    }
    if (!result.success) {
      this.logger.error("Unable to search", { term, registry }, result);
    } else {
      try {
        // Docker outputs multiple JSON lines - not an array of objects
        const output = isDocker ? `[${(result.stdout || "").trim().split(/\r?\n/).join(",")}]` : result.stdout;
        if (output) {
          items = JSON.parse(output);
        } else {
          this.logger.warn("Empty output", result);
        }
      } catch (error: any) {
        this.logger.error("Search results parsing error", error.message, error.stack);
      }
    }
    return coerceAndSortSearchResults(items);
  }

  async pullFromRegistry(opts: RegistryPullOptions) {
    // biome-ignore lint/correctness/noUnusedVariables: Available for future use
    const { image, onProgress } = opts;
    this.logger.debug("pull from registry", image);
    const host = this._currentContainerEngineHostClient as AbstractContainerEngineHostClient;
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
  async getConnectionApi<T extends AbstractContainerEngineHostClient = AbstractContainerEngineHostClient>(
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

  getCurrentEngineConnectionApi<T extends ContainerEngineHostClient = AbstractContainerEngineHostClient>() {
    return this._currentContainerEngineHostClient as T;
  }

  protected startupStatus: StartupStatus = StartupStatus.STOPPED;

  async createConnectorContainerEngineHostClient(
    connector: Connector,
    opts?: ConnectOptions,
  ): Promise<{
    host: AbstractContainerEngineHostClient | undefined;
    availability: EngineConnectorAvailability;
  }> {
    this.logger.debug(connector.id, ">> Creating connector host api", opts);
    const startApi = opts?.startApi ?? false;
    let host: AbstractContainerEngineHostClient | undefined;
    let availability = connector.availability;
    try {
      const Engine = this.runtimes.find((it) => it.ENGINE === connector.engine);
      if (!Engine) {
        this.logger.error(connector.id, "Connector engine not found", connector.engine);
        throw new Error("Connector engine not found");
      }
      host = await Engine.createEngineHostClientByName(connector.host, connector.id);
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
        host.setLogLevel(this.logLevel);
        await host.setSettings(settings);
        if (settings.mode === "mode.automatic") {
          const scope = settings.controller?.scope || "";
          if (opts?.skipAvailabilityCheck) {
            this.logger.warn(connector.id, "Skipping automatic settings - availability check disabled");
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
            this.logger.warn("Using automatic settings", automaticSettings);
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
            this.logger.warn(connector.id, "Skipping availability check");
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
      this.runtimes = await async.parallel(
        RUNTIMES.map(
          (Engine) => (cb: any) =>
            Engine.create(this.osType)
              .then((engine) => {
                engine.setLogLevel(this.logLevel);
                cb(null, engine);
              })
              .catch(cb),
        ),
      );
      // console.debug(">> INIT", { osType: this.osType });
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
    const host = this._currentContainerEngineHostClient as AbstractContainerEngineHostClient;
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
        if (!connector.settings?.api?.connection?.uri) {
          switch (opts.connection?.host) {
            case ContainerEngineHost.PODMAN_REMOTE:
            case ContainerEngineHost.DOCKER_REMOTE:
              if (this.osType === OperatingSystem.Windows) {
                connector.settings.api.connection.uri = getWindowsPipePath(connector.id);
              } else {
                const userData = await Platform.getUserDataPath();
                connector.settings.api.connection.uri = await Path.join(
                  userData,
                  `container-desktop-ssh-relay-${connector.id}`,
                );
              }
              break;
            default:
              break;
          }
        }
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
          this._currentContainerEngineHostClient = host;
          console.debug("> Host settings are", { host: engineSettings, connector: connector.settings });
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
