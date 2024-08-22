import * as async from "async";
import { v4 } from "uuid";

import { AbstractClientEngine, createConnectorBy, Docker, getDefaultConnectors, Podman, RUNTIMES } from "@/container-client";
import { UserConfiguration } from "@/container-client/config";
import { AbstractRuntime, ClientEngine } from "@/container-client/runtimes/abstract/base";
import { PodmanAbstractClientEngine, PodmanClientEngineCommon } from "@/container-client/runtimes/podman/base";
import {
  ApplicationEnvironment,
  CommandExecutionResult,
  Connection,
  ConnectOptions,
  Connector,
  ContainerConnectOptions,
  ContainerEngine,
  ControllerScope,
  CreateMachineOptions,
  DisconnectOptions,
  EngineConnectorAvailability,
  EngineConnectorSettings,
  GlobalUserSettings,
  ILogger,
  OpenFileSelectorOptions,
  OpenTerminalOptions,
  Program,
  RegistriesMap,
  RegistryPullOptions,
  RegistrySearchOptions
} from "@/env/Types";
import { createLogger, getLevel, setLevel } from "@/logger";
import { OperatingSystem } from "@/platform";
import { launchTerminal } from "@/terminal";
import { deepMerge } from "@/utils";

const AUTOMATIC_REGISTRIES = [
  {
    id: "system",
    name: "Podman configuration",
    created: new Date().toISOString(),
    weight: -1,
    isRemovable: false,
    isSystem: true,
    enabled: true
  }
];
const PROPOSED_REGISTRIES = [
  {
    id: "quay.io",
    name: "quay.io",
    created: new Date().toISOString(),
    weight: 0,
    isRemovable: true,
    isSystem: false,
    enabled: true
  },
  {
    id: "docker.io",
    name: "docker.io",
    created: new Date().toISOString(),
    weight: 1000,
    isRemovable: true,
    isSystem: false,
    enabled: true
  }
];

export const coerceAndSortSearchResults = (items) => {
  items = items.map((it) => {
    if (typeof it.Stars === "undefined") {
      it.Stars = 0;
      if (typeof it.StarCount !== "undefined") {
        it.Stars = Number(it.StarCount);
      }
    }
    return it;
  });
  // 1st sort by name
  items = items.sort((a, b) => {
    return a.Name.localeCompare(b.Name, "en", { numeric: true });
  });
  // 2nd sort by stars
  items = items.sort((a, b) => {
    return b.Stars - a.Stars;
  });
  return items;
};

export class Application {
  private static instance: Application;

  protected logger!: ILogger;
  protected messageBus!: IMessageBus;
  protected userConfiguration!: UserConfiguration;
  protected osType: OperatingSystem;
  protected version: string;
  protected environment: string;
  protected connectionApis: { [key: string]: AbstractClientEngine } = {};
  protected inited: boolean = false;
  protected runtimes: AbstractRuntime[] = [];
  protected connectors: Connector[] = [];

  protected _currentClientEngine!: ClientEngine;

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
        osType: OperatingSystem.Windows,
        version: import.meta.env.PROJECT_VERSION,
        environment: import.meta.env.ENVIRONMENT,
        messageBus: (window as any).MessageBus
      });
    }
    return Application.instance;
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
    if (settings && settings?.logging?.level) {
      await setLevel(settings?.logging?.level);
    }
    await this.userConfiguration.setSettings(settings);
    return await this.getGlobalUserSettings();
  }

  async getGlobalUserSettings() {
    return {
      theme: await this.userConfiguration.getKey("theme", "bp5-dark"),
      expandSidebar: await this.userConfiguration.getKey("expandSidebar", true),
      startApi: await this.userConfiguration.getKey("startApi", false),
      minimizeToSystemTray: await this.userConfiguration.getKey("minimizeToSystemTray", false),
      checkLatestVersion: await this.userConfiguration.getKey("checkLatestVersion", false),
      path: await await this.userConfiguration.getStoragePath(),
      logging: {
        level: await getLevel()
      },
      connector: await this.userConfiguration.getKey("connector")
    } as GlobalUserSettings;
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
    const currentApi = this.getCurrentEngineConnectionApi<PodmanClientEngineCommon>();
    return await currentApi.getPodLogs(id, tail);
  }
  async generateKube(entityId?: any) {
    const currentApi = this.getCurrentEngineConnectionApi<PodmanClientEngineCommon>();
    return await currentApi.generateKube(entityId);
  }
  async inspectPodmanMachine(name: string) {
    const currentApi = this.getCurrentEngineConnectionApi<PodmanAbstractClientEngine>();
    return await currentApi.inspectPodmanMachine(name);
  }
  async getPodmanMachines() {
    const currentApi = this.getCurrentEngineConnectionApi<PodmanAbstractClientEngine>();
    return await currentApi.getPodmanMachines();
  }
  async createPodmanMachine(opts: CreateMachineOptions) {
    const currentApi = this.getCurrentEngineConnectionApi<PodmanAbstractClientEngine>();
    return await currentApi.createPodmanMachine(opts);
  }
  async removePodmanMachine(name: string) {
    const currentApi = this.getCurrentEngineConnectionApi<PodmanAbstractClientEngine>();
    return await currentApi.removePodmanMachine(name);
  }
  async stopPodmanMachine(name: string) {
    const currentApi = this.getCurrentEngineConnectionApi<PodmanAbstractClientEngine>();
    return await currentApi.stopPodmanMachine(name);
  }
  async restartPodmanMachine(name: string) {
    const currentApi = this.getCurrentEngineConnectionApi<PodmanAbstractClientEngine>();
    return await currentApi.restartPodmanMachine(name);
  }
  async connectToPodmanMachine(name: string) {
    const currentApi = this.getCurrentEngineConnectionApi<PodmanAbstractClientEngine>();
    return await currentApi.connectToPodmanMachine(name);
  }

  // Scope actions
  async getControllerScopes(connection: Connection) {
    const currentApi = await this.getConnectionApi(connection);
    this.logger.debug("Listing controller scopes of current engine", connection);
    return await currentApi.getControllerScopes();
  }

  async startScope(scope: ControllerScope, connection: Connection) {
    let flag = false;
    const currentApi = await this.getConnectionApi(connection);
    if (currentApi.isScoped()) {
      this.logger.debug(">> Starting scope", scope, "with connection", connection);
      flag = await currentApi.startScope(scope);
      this.logger.debug("<< Starting scope", scope, "with connection", flag, connection);
    }
    return flag;
  }

  async stopScope(scope: ControllerScope, connection: Connection) {
    let flag = false;
    const currentApi = await this.getConnectionApi(connection);
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
    if (currentApi.isScoped()) {
      launcherPath = controller?.path || controller?.name || "";
    } else {
      launcherPath = program.path || program.name;
    }
    const launcherArgs = ["exec", "-it", id, shell || "/bin/sh"];
    const output = await launchTerminal(launcherPath, launcherArgs, {
      title: title || `${currentApi.RUNTIME} container`
    });
    if (!output.success) {
      this.logger.error("Unable to connect to container", id, output);
    }
    return output.success;
  }

  async findProgram(connection: Connection, program: Program, insideScope?: boolean) {
    const api = await this.getConnectionApi(connection);
    let outputProgram: Program = {
      ...program,
      path: ""
    };
    this.logger.debug(connection.id, ">> Find program", insideScope ? "inside" : "outside", "scope", { connector: deepMerge({}, connection), program: outputProgram });
    if (insideScope) {
      outputProgram = await api.findScopeProgram(outputProgram);
    } else {
      outputProgram = await api.findHostProgram(program);
    }
    this.logger.debug(connection.id, "<< Find program", insideScope ? "inside" : "outside", "scope", outputProgram);
    return outputProgram;
  }

  async findProgramVersion(connection: Connection, program: Program, insideScope?: boolean) {
    const api = await this.getConnectionApi(connection);
    let version = "";
    this.logger.debug(connection.id, ">> Find program version", insideScope ? "inside" : "outside", "scope", { connector: deepMerge({}, connection), program });
    if (insideScope) {
      version = await api.findScopeProgramVersion(program);
    } else {
      version = await api.findHostProgramVersion(program);
    }
    this.logger.debug(connection.id, "<< Find program version", insideScope ? "inside" : "outside", "scope", version, { connector: deepMerge({}, connection), program });
    return version;
  }

  // Connection

  async createConnection(connection: Connection) {
    this.logger.debug("Create connection", connection);
    let connections: Connection[] = await this.userConfiguration.getKey("connections");
    if (!connections) {
      connections = [];
    }
    connections.push({
      id: connection.id,
      name: connection.name,
      label: connection.label,
      engine: connection.engine,
      runtime: connection.runtime,
      settings: connection.settings
    });
    await this.userConfiguration.setKey("connections", connections);
    return connection;
  }

  async updateConnection(id: string, connection: Partial<Connection>) {
    const connections: Connection[] = await this.userConfiguration.getKey("connections");
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
      let connections: Connection[] = await this.userConfiguration.getKey("connections");
      connections = connections.filter((it) => it.id !== id);
      await this.userConfiguration.setKey("connections", connections);
    } catch (error: any) {
      this.logger.error("Unable to remove connection", error.message);
      return false;
    }
    return true;
  }

  async getConnections() {
    const connections: Connection[] = await this.userConfiguration.getKey("connections");
    return connections || [];
  }

  async getConnectionDataDir(connection: Connection) {
    const engine = await this.getConnectionApi(connection);
    return await engine.getConnectionDataDir();
  }

  // System
  async getIsApiRunning(connection?: Connection) {
    let currentApi = this._currentClientEngine;
    if (connection) {
      currentApi = await this.getConnectionApi(connection);
    }
    return currentApi ? await currentApi.isApiRunning() : false;
  }

  async getSystemInfo(connection?: Connection, customFormat?: string) {
    let currentApi = this._currentClientEngine;
    if (connection) {
      currentApi = await this.getConnectionApi(connection);
    }
    return await currentApi.getSystemInfo(connection, customFormat);
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
        database: undefined
      },
      counts: {
        CRITICAL: 0,
        HIGH: 0,
        MEDIUM: 0,
        LOW: 0
      },
      result: undefined,
      fault: undefined
    };
    try {
      let program: Program;
      const scanner = options?.scanner || "trivy";
      const settings = await currentApi.getSettings();
      const scope = settings.controller?.scope || "";
      const useScope = currentApi.isScoped() && ![ContainerEngine.PODMAN_VIRTUALIZED_VENDOR, ContainerEngine.DOCKER_VIRTUALIZED_VENDOR].includes(currentApi.ENGINE);
      if (useScope) {
        program = await currentApi.findScopeProgram({ name: options.scanner, path: "" });
      } else {
        program = await currentApi.findHostProgram({ name: options.scanner, path: "" });
      }
      const programPath = program?.path || program?.name || scanner;
      // support only trivy for now
      if (programPath) {
        report.scanner.path = programPath;
        report.scanner.name = options.scanner;
        report.scanner.version = program?.version || "";
        report.scanner.database = {}; // TODO: get database info

        let result;
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
            let analysis;
            if (useScope) {
              analysis = await currentApi.runScopeCommand(programPath, ["--quiet", options.subject, "--format", "json", options.target], scope);
            } else {
              analysis = await currentApi.runHostCommand(programPath, ["--quiet", options.subject, "--format", "json", options.target]);
            }
            if (analysis?.success && analysis.stdout !== "null") {
              const priorities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
              const sorter = (a, b) => {
                return priorities.indexOf(b.Severity) - priorities.indexOf(a.Severity);
              };
              try {
                const data = JSON.parse(analysis.stdout);
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
                  message: error.message
                };
              }
            } else {
              this.logger.error("Analysis failed", analysis);
              report.fault = {
                detail: "Analysis failed",
                message: report.stderr
              };
            }
          } catch (error: any) {
            this.logger.error("Error during scanning process", error.message);
            report.fault = {
              detail: "Error during scanning process",
              message: error.message
            };
          }
        }
      }
    } catch (error: any) {
      this.logger.error("Error during scanner detection", error.message);
      report.fault = {
        detail: "Error during scanner detection",
        message: error.message
      };
    }
    return report;
  }

  // registry
  async getRegistriesMap() {
    const engine = this._currentClientEngine as AbstractClientEngine;
    const isPodman = engine.RUNTIME === Podman.Runtime.RUNTIME;
    const customRegistriesPath = await Path.join(await this.userConfiguration.getStoragePath(), "registries.json");
    const registriesMap = {
      default: AUTOMATIC_REGISTRIES.map((it) => (it.id === "system" && !isPodman ? { ...it, enabled: false } : it)),
      custom: PROPOSED_REGISTRIES
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
    const engine = this._currentClientEngine as AbstractClientEngine;
    const { program } = await engine.getSettings();
    const filtersList: any[] = [];
    const programArgs = ["search"];
    const isPodman = engine.RUNTIME === Podman.Runtime.RUNTIME;
    const isDocker = engine.RUNTIME === Docker.Runtime.RUNTIME;
    if (isPodman) {
      // Search using API
      if (registry?.id === "system") {
        const driver = await engine.getContainerApiClient().getDriver();
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
          url: `/images/search?${searchParams.toString()}`
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
      if (filters?.isOfficial) {
        filtersList.push("--filter", "is-official=[OK]");
      }
      if (filters?.isAutomated) {
        filtersList.push("--filter", "is-automated=[OK]");
      }
      programArgs.push(...filtersList);
      programArgs.push(...[`${registry.name}/${term}`, "--format", "{{json .}}"]);
    }
    const currentApi = this.getCurrentEngineConnectionApi();
    let result;
    if (currentApi.isScoped()) {
      const { controller } = await currentApi.getSettings();
      result = await currentApi.runScopeCommand(program.path, programArgs, controller?.scope || "");
    } else {
      result = await currentApi.runHostCommand(program.path, programArgs);
    }
    if (!result.success) {
      this.logger.error("Unable to search", { term, registry }, result);
    } else {
      try {
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
    const { image, onProgress } = opts;
    this.logger.debug("pull from registry", image);
    const engine = this._currentClientEngine as AbstractClientEngine;
    const { program, controller } = await engine.getSettings();
    let result: CommandExecutionResult;
    if (engine.isScoped()) {
      result = await engine.runScopeCommand(program.path, ["image", "pull", image], controller?.scope || "");
    } else {
      result = await engine.runHostCommand(program.path, ["image", "pull", image]);
    }
    return result;
  }

  // Main
  async getConnectionApi<T extends AbstractClientEngine = AbstractClientEngine>(connection: Connection) {
    if (this.connectionApis[connection.id]) {
      this.logger.debug("Using connection api - found", connection.id);
      this.connectionApis[connection.id].setSettings(connection.settings);
    } else {
      this.logger.debug("Using connection api - creating", connection.id);
      const connector = deepMerge<Connector>({}, createConnectorBy(this.osType, connection.runtime, connection.engine), connection);
      try {
        const { engine, availability } = await this.createConnectorClientEngine(connector);
        connector.availability = availability;
        if (engine) {
          this.connectionApis[connection.id] = engine;
        } else {
          this.logger.error("Unable to create connection api", connector.id);
        }
      } catch (error: any) {
        this.logger.error("Unable to create connection api", connector.id, error.message, error.stack);
      }
    }
    return this.connectionApis[connection.id] as T;
  }

  getCurrentEngineConnectionApi<T extends ClientEngine = AbstractClientEngine>() {
    return this._currentClientEngine as T;
  }

  async createConnectorClientEngine(connector: Connector, opts?: ConnectOptions): Promise<{ engine: AbstractClientEngine | undefined; availability: EngineConnectorAvailability }> {
    this.logger.debug(connector.id, ">> Creating connector engine api", opts);
    const startApi = opts?.startApi ?? false;
    let engine: AbstractClientEngine | undefined = undefined;
    let availability = connector.availability;
    try {
      const Runtime = this.runtimes.find((it) => it.RUNTIME === connector.runtime);
      if (!Runtime) {
        this.logger.error(connector.id, "Connector runtime not found", connector.runtime);
        throw new Error("Connector runtime not found");
      }
      engine = await Runtime.createEngineByName(connector.engine, connector.id);
      if (!engine) {
        this.logger.error(connector.id, "Connector engine not found", connector.engine);
        throw new Error("Connector engine not found");
      }
      if (engine) {
        const settings = opts?.connection.settings || connector.settings;
        this.logger.debug(connector.id, "Using custom current engine settings", settings);
        await engine.setSettings(settings);
        if (startApi) {
          try {
            await engine.startApi();
          } catch (error: any) {
            this.logger.error(connector.id, "Unable to start the engine API", error);
          }
        }
        // Read availability
        this.logger.debug(connector.id, ">> Reading engine availability");
        try {
          availability = await engine.getAvailability(connector.settings);
        } catch (error: any) {
          this.logger.error(connector.id, "<< Reading engine availability failed", error);
        }
        this.logger.debug(connector.id, "<< Reading engine availability", availability);
      }
    } catch (error: any) {
      this.logger.error(connector.id, "Connector engine api creation error", error);
    }
    this.logger.debug(connector.id, "<< Creating connector engine api", { engine, availability });
    return { engine, availability };
  }

  async init() {
    // All logic is done only once at application startup - can be updated during engine changes by the start logic
    if (this.inited) {
      this.logger.debug("Init skipping - already initialized");
      return this.inited;
    }
    this.logger.debug("Creating application bridge");
    try {
      this.runtimes = await async.parallel(
        RUNTIMES.map(
          (Runtime) => (cb: any) =>
            Runtime.create(this.osType)
              .then((runtime) => cb(null, runtime))
              .catch(cb)
        )
      );
      this.connectors = getDefaultConnectors(this.osType);
    } catch (error: any) {
      this.logger.error("Init - Unable to initialize application runtimes", error.message, error.stack);
    }
    this.inited = true;
    return this.inited;
  }

  async stop(opts?: DisconnectOptions): Promise<boolean> {
    const engine = this._currentClientEngine as AbstractClientEngine;
    if (engine) {
      this.logger.debug(">> Bridge stop started", opts, engine.id);
      await engine.stopApi();
      if (engine.isScoped()) {
        const settings = await engine.getSettings();
        if (settings.controller?.scope) {
          await engine.stopScopeByName(settings.controller?.scope);
        }
      }
      this.logger.debug(">> Bridge stop completed", opts, engine.id);
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
      if (opts?.connection) {
        connector = createConnectorBy(this.osType, opts.connection.runtime, opts.connection.engine);
        connector.connectionId = opts.connection.id;
        connector.name = opts.connection.name;
        connector.label = opts.connection.label;
        connector.disabled = opts.connection.disabled ?? false;
        connector.settings = deepMerge({}, opts.connection.settings);
        if (!connector) {
          this.logger.error("Bridge startup - no connector found", opts);
          throw new Error("No connector found");
        }
        const { engine, availability } = await this.createConnectorClientEngine(connector, opts);
        if (engine) {
          connector.availability = availability;
          this._currentClientEngine = engine;
        } else {
          throw new Error("Unable to create current engine connection");
        }
      }
    } catch (error: any) {
      this.logger.error("Bridge startup error", error);
    }
    return connector;
  }

  async setup() {
    this.logger = await createLogger("bridge.application");
    this.inited = await this.init();
    return { logger: this.logger };
  }
}
