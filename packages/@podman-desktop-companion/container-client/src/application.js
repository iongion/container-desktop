// node
const os = require("os");
// vendors
const merge = require("lodash.merge");
// project
const { setLevel, getLevel, createLogger } = require("@podman-desktop-companion/logger");
const { launchTerminal } = require("@podman-desktop-companion/terminal");
// module
const { Podman, Docker } = require("./adapters");
const { UserConfiguration } = require("./configuration");
const { getApiConfig } = require("./api");
const { findProgram, findProgramVersion } = require("./detector");
// locals
const DEFAULT_CONNECTORS = [
  // Podman
  {
    adapter: Podman.Adapter.ADAPTER,
    engine: Podman.ENGINE_PODMAN_NATIVE,
    id: "engine.default.podman.native",
    availability: {
      all: false,
      api: false,
      engine: false,
      program: false,
      api: false,
      report: {
        engine: "Not checked",
        program: "Not checked",
        api: "Not checked"
      }
    },
    settings: {
      expected: {},
      detected: {},
      automatic: {},
      user: {},
      current: {
        api: {
          baseURL: "",
          connectionString: ""
        },
        program: {
          name: "podman",
          path: undefined,
          version: undefined
        }
      }
    }
  },
  {
    adapter: Podman.Adapter.ADAPTER,
    engine: Podman.ENGINE_PODMAN_VIRTUALIZED,
    id: "engine.default.podman.virtualized",
    availability: {
      all: false,
      api: false,
      engine: false,
      program: false,
      controller: false,
      api: false,
      report: {
        engine: "Not checked",
        program: "Not checked",
        api: "Not checked",
        controller: "Not checked"
      }
    },
    settings: {
      expected: {},
      detected: {},
      automatic: {},
      user: {},
      current: {
        api: {
          baseURL: "",
          connectionString: ""
        },
        program: {
          name: "podman",
          path: undefined,
          version: undefined
        },
        controller: {
          name: "podman",
          path: undefined,
          version: undefined
        }
      }
    }
  },
  // Docker
  {
    adapter: Docker.Adapter.ADAPTER,
    engine: Docker.ENGINE_DOCKER_NATIVE,
    id: "engine.default.docker.native",
    availability: {
      all: false,
      api: false,
      engine: false,
      program: false,
      api: false,
      report: {
        engine: "Not checked",
        program: "Not checked",
        api: "Not checked"
      }
    },
    settings: {
      expected: {},
      detected: {},
      automatic: {},
      user: {},
      current: {
        api: {
          baseURL: "",
          connectionString: ""
        },
        program: {
          name: "docker",
          path: undefined,
          version: undefined
        }
      }
    }
  },
  {
    adapter: Docker.Adapter.ADAPTER,
    engine: Docker.ENGINE_DOCKER_VIRTUALIZED,
    id: "engine.default.docker.virtualized",
    availability: {
      all: false,
      api: false,
      engine: false,
      program: false,
      controller: false,
      api: false,
      report: {
        engine: "Not checked",
        program: "Not checked",
        api: "Not checked",
        controller: "Not checked"
      }
    },
    settings: {
      expected: {},
      detected: {},
      automatic: {},
      user: {},
      current: {
        api: {
          baseURL: "",
          connectionString: ""
        },
        program: {
          name: "docker",
          path: undefined,
          version: undefined
        },
        controller: {
          name: "docker",
          path: undefined,
          version: undefined
        }
      }
    }
  }
];

class Application {
  constructor(opts) {
    this.version = opts.version;
    this.environment = opts.environment;
    this.osType = opts.osType || os.type();
    this.logger = createLogger("container-client.Application");
    this.configuration = new UserConfiguration(opts.version, opts.environment);
    this.adaptersList = [Podman.Adapter, Docker.Adapter];
    // available only after start - hydrated in this order
    this.adapters = [];
    this.currentAdapter = undefined;
    this.engines = [];
    this.currentEngine = undefined;
    this.connectors = opts.connectors || [];
    this.currentConnector = opts.currentConnector || undefined;
    this.inited = !!opts.inited;
    this.started = !!opts.started;
    this.logger.debug("%c Created application controller", "background: #222; color: #bada55", opts);
  }

  async invoke(method, params, context) {
    let reply = {
      success: false,
      result: undefined,
      warnings: []
    };
    const service = this[method];
    if (service) {
      try {
        // logger.debug("Invoking", method, params);
        reply.success = true;
        reply.result = await service.apply(this, [params]);
      } catch (error) {
        const result = {
          error: "Service invocation error",
          method,
          params
        };
        if (error.response) {
          result.response = error.response;
        }
        logger.error("Service error", result, error.message, error.stack);
        reply.success = false;
        reply.result = result;
      }
    } else {
      const result = {
        error: "No such IPC method",
        method: method
      };
      logger.error("Service error", result);
      reply.success = false;
      reply.result = result;
    }
    return reply;
  }

  async getAdapters() {
    if (this.adapters.length) {
      this.logger.debug("Reusing adapters list", this.adapters);
    } else {
      // Optimize if current cached connector exists - only instantiate a single adapter
      const currentConnector = this.currentConnector;
      if (currentConnector) {
        this.logger.debug("Computing single adapter for current connector", currentConnector.adapter);
        const Adapter = this.adaptersList.find((it) => it.ADAPTER === currentConnector.adapter);
        this.adapters = [new Adapter(this.configuration, this.osType)];
      } else {
        this.logger.debug("Computing all adapters list");
        this.adapters = this.adaptersList.map((Adapter) => {
          const adapter = new Adapter(this.configuration, this.osType);
          return adapter;
        });
      }
    }
    return this.adapters;
  }

  async getCurrentAdapter() {
    if (this.currentAdapter) {
      this.logger.debug("Reusing current adapter", this.currentAdapter);
    } else {
      this.logger.debug("Computing current adapter");
      const adapters = await this.getAdapters();
      this.currentAdapter = adapters.find((it) => it.ADAPTER === this.currentConnector.adapter);
    }
    return this.currentAdapter;
  }

  async getEngines() {
    if (this.engines.length) {
      this.logger.debug("Reusing engines list", this.engines);
    } else {
      this.logger.debug("Computing engines list");
      const items = [];
      const adapters = await this.getAdapters();
      await Promise.all(
        adapters.map(async (adapter) => {
          const adapterEngines = await adapter.createEngines();
          items.push(...adapterEngines);
        })
      );
      if (this.connectors.length) {
        items.forEach((engine) => {
          const connector = this.connectors.find((it) => it.id === engine.id);
          if (connector) {
            this.logger.debug("Restore engine detected settings", engine.id, connector.settings.detected);
            engine.setDetectedSettings(connector.settings.detected);
          }
        });
      }
      this.engines = items;
    }
    return this.engines;
  }

  async getCurrentEngine() {
    if (this.currentEngine) {
      this.logger.debug("Reusing current engine", this.currentEngine);
    } else {
      this.logger.debug("Computing current engine");
      const engines = await this.getEngines();
      this.currentEngine = engines.find((it) => it.id === this.currentConnector.id);
    }
    return this.currentEngine;
  }

  async getConnectors() {
    if (this.connectors.length) {
      this.logger.debug("Reusing connectors list");
    } else {
      this.logger.debug("Computing connectors list");
      const items = [];
      const engines = await this.getEngines();
      await Promise.all(
        engines.map(async (engine) => {
          const connector = await engine.getConnector({ detect: true });
          items.push(connector);
        })
      );
      this.connectors = items;
    }
    return this.connectors;
  }

  async getCurrentConnector() {
    if (!this.currentConnector) {
      this.logger.debug("Computing current connector");
      const connectors = await this.getConnectors();
      this.logger.error("Unable to init without any usable connector - picking preferred(favor podman)");
      this.currentConnector = connectors.find(({ id }) => {
        if (this.osType === "Windows_NT" || this.osType === "Darwin") {
          return id === "engine.default.podman.virtualized";
        }
        return id === "engine.default.podman.native";
      });
    }
    return this.currentConnector;
  }

  // init
  async init(opts) {
    const { startApi, adapter, connector } = merge(
      {
        // defaults
        startApi: this.configuration.getKey("startApi", false),
        adapter: Podman.Adapter.ADAPTER,
        connector: this.configuration.getKey("connector.default")
      },
      opts || {}
    );
    this.adapters = await this.getAdapters();
    this.engines = await this.getEngines();
    this.connectors = await this.getConnectors();
    // 1st source - user preferred
    if (connector) {
      this.currentConnector = this.connectors.find(({ id }) => {
        return id === connector;
      });
    }
    // Factory preferred - favor podman
    if (!this.currentConnector) {
      this.logger.error("Unable to init without any usable connector - picking preferred(favor podman)");
      this.currentConnector = this.connectors.find(({ id }) => {
        if (this.osType === "Windows_NT" || this.osType === "Darwin") {
          return id === "engine.default.podman.virtualized";
        }
        return id === "engine.default.podman.native";
      });
    }
    // current adapter inferred from connector
    this.currentAdapter = await this.getCurrentAdapter();
    // current engine
    this.currentEngine = await this.getCurrentEngine();
    if (!this.currentEngine) {
      this.logger.error("Unable to init without any usable engine");
      return false;
    }
    this.inited = true;
    return true;
  }

  // exec
  async exec(opts) {
    const inited = await this.init(opts);
    if (!inited) {
      this.logger.error("Unable to start - init incomplete");
      return false;
    }
    const { startApi, adapter, connector } = merge(
      {
        // defaults
        startApi: this.configuration.getKey("startApi", false),
        adapter: Podman.Adapter.ADAPTER,
        connector: this.configuration.getKey("connector.default")
      },
      opts || {}
    );
    // Perform additional detections upon API availability
    const updaterAfterStart = async () => {
      if (this.started) {
        this.logger.debug("Updating connector post successful start-up to get updated details");
        const currentEngine = await this.getCurrentEngine();
        this.currentConnector = await currentEngine.getConnector({ detect: true, started: this.started });
        // Update connector state
        this.connectors = this.connectors.map((it) => {
          if (it.id === this.currentConnector.id) {
            return { ...it, ...this.currentConnector };
          }
          return it;
        });
      } else {
        this.logger.warn("Updating connector skipped - not started");
      }
    };
    // Start API only if specified
    this.started = !!this.currentConnector.availability.api;
    if (this.started) {
      this.logger.debug("Skipping startup - API is already running");
      await updaterAfterStart();
    } else if (startApi) {
      try {
        const currentEngine = await this.getCurrentEngine();
        this.started = await currentEngine.startApi();
        await updaterAfterStart();
      } catch (error) {
        this.started = false;
        this.logger.error("Application start error", error);
      }
    } else {
      this.logger.debug("Skipping startup - startApi is not flagged for auto start neither is it running");
    }
    return this.started;
  }

  async start(opts) {
    this.logger.debug("Application starting");
    try {
      await this.exec(opts);
    } catch (error) {
      this.adaptersList = [Podman.Adapter];
      this.logger.error("Application startup error - unable to execute", error.message, error.stack);
    }
    const defaultConnector = this.osType === "Linux" ? DEFAULT_CONNECTORS[0] : DEFAULT_CONNECTORS[1];
    let descriptor = {
      connectors: DEFAULT_CONNECTORS,
      currentConnector: defaultConnector,
      environment: this.environment || "unknown",
      platform: this.osTye || "Unknown",
      provisioned: false,
      running: false,
      userSettings: {
        connector: { default: "engine.default.podman.native" },
        logging: { level: "debug" },
        minimizeToSystemTray: false,
        path: this.configuration.getStoragePath(),
        startApi: true
      }
    };
    try {
      descriptor = await this.getDescriptor();
      if (!descriptor.currentConnector) {
        descriptor.currentConnector = defaultConnector;
      }
    } catch (error) {
      this.logger.error(
        "Application startup error - fatal error - unable to create descriptor",
        error.message,
        error.stack
      );
    }
    this.logger.debug("Application startup descriptor", descriptor);
    return descriptor;
  }

  async stop() {
    if (!this.started) {
      this.logger.debug("Stop skipped - not started");
    }
    const currentEngine = await this.getCurrentEngine();
    const stopped = await currentEngine.stopApi();
    this.stared = !stopped;
    return stopped;
  }

  // proxying

  async createApiRequest(opts, driverOpts) {
    const currentEngine = await this.getCurrentEngine();
    // Normalize response
    let result = {
      ok: false,
      data: undefined,
      headers: [],
      status: 500,
      statusText: "API request error"
    };
    try {
      if (!currentEngine) {
        this.logger.error("Cannot create api request - no valid client for current engine");
        throw new Error("No valid client for current engine");
      }
      const driver = await currentEngine.getApiDriver(driverOpts);
      const response = await driver.request(opts);
      result = {
        ok: response.status >= 200 && response.status < 300,
        data: response.data,
        headers: response.headers,
        status: response.status,
        statusText: response.statusText
      };
    } catch (error) {
      if (error.response) {
        result = {
          ok: false,
          data: error.response.data,
          headers: error.response.headers,
          status: error.response.status,
          statusText: error.response.statusText
        };
      } else {
        result.statusText = error.message || "API request error";
      }
    }
    return result;
  }

  // configuration

  async setGlobalUserSettings(opts) {
    this.logger.debug("Updating global user settings", opts);
    Object.keys(opts).forEach((key) => {
      const value = opts[key];
      this.configuration.setKey(key, value);
      if (key === "logging") {
        setLevel(value.level);
      }
    });
    return await this.getGlobalUserSettings();
  }

  async getGlobalUserSettings() {
    return {
      startApi: this.configuration.getKey("startApi", false),
      minimizeToSystemTray: this.configuration.getKey("minimizeToSystemTray", false),
      path: this.configuration.getStoragePath(),
      logging: {
        level: getLevel()
      },
      connector: {
        default: this.configuration.getKey("connector.default")
      }
    };
  }

  async setEngineUserSettings({ id, settings }) {
    const engines = await this.getEngines();
    const engine = engines.find((it) => it.id === id);
    if (!engine) {
      this.logger.error("Unable to update settings of missing engine instance", id);
      throw new Error("Update failed - no engine");
    }
    return await engine.setUserSettings(settings);
  }

  async getEngineUserSettings(id) {
    const engines = await this.getEngines();
    const engine = engines.find((it) => it.id === id);
    return await engine.getUserSettings();
  }

  // introspection

  async getSystemInfo() {
    const currentEngine = await this.getCurrentEngine();
    return await currentEngine.getSystemInfo();
  }
  async getMachines() {
    const currentAdapter = await this.getCurrentAdapter();
    const currentEngine = await this.getCurrentEngine();
    return await currentAdapter.getMachines(currentEngine);
  }

  // finders & testers
  async findProgram(opts) {
    const engines = await this.getEngines();
    const engine = engines.find((it) => it.id === opts.id);
    if (!engine) {
      this.logger.error("Unable to find a matching engine", opts.id);
      throw new Error("Find failed - no engine");
    }
    try {
      const locator = opts.engine === Podman.ENGINE_PODMAN_VIRTUALIZED ? "whereis" : "which";
      const result = await engine.getScopedCommand(locator, [opts.program], { scope: opts.scope });
      const wrapper = { launcher: result.launcher, args: result.command.slice(0, -2) };
      const detect = await findProgram(opts.program, { wrapper });
      return detect;
    } catch (error) {
      this.logger.error("Unable to find program", error.message);
    }
  }

  async test({ subject, payload }) {
    let result = { success: false };
    switch (subject) {
      case "reachability.api":
        result = this.testApiReachability(payload);
        break;
      case "reachability.program":
        result = this.testEngineProgramReachability(payload);
        break;
      default:
        result.details = `Unable to perform unknown test subject "${subject}"`;
        break;
    }
    return result;
  }

  async testEngineProgramReachability(opts) {
    const result = { success: false };
    this.logger.debug("Testing if program is reachable", opts);
    const { engine, id, controller, program } = opts;
    const testController =
      controller?.path && [Podman.ENGINE_PODMAN_VIRTUALIZED, Docker.ENGINE_DOCKER_VIRTUALIZED].includes(engine);
    if (testController) {
      try {
        const version = await findProgramVersion(controller.path);
        if (!version) {
          throw new Error("Test failed - no version");
        }
        if (version) {
          result.success = true;
          result.details = `Program has been found - version ${version}`;
        }
      } catch (error) {
        this.logger.error("Testing if program is reachable - failed during detection", error.message);
        result.details = "Program detection error";
      }
    } else if (program.path) {
      try {
        const engines = await this.getEngines();
        const engine = engines.find((it) => it.id === id);
        if (!engine) {
          this.logger.error("Unable to test engine program reachability - no engine", opts);
          throw new Error("Test failed - no engine");
        }
        const check = await engine.runScopedCommand(program.path, ["--version"]);
        this.logger.debug("Testing if program is reachable - completed", check);
        if (check.success) {
          result.success = true;
          result.details = "Program has been found";
        }
      } catch (error) {
        this.logger.error("Testing if program is reachable - failed during detection", error.message);
        result.details = "Program detection error";
      }
    }
    return result;
  }

  async testApiReachability(opts) {
    const engines = await this.getEngines();
    const engine = engines.find((it) => it.id === opts.id);
    if (!engine) {
      this.logger.error("Unable to find a matching engine", opts.id);
      throw new Error("Find failed - no engine");
    }

    const result = { success: false };
    const config = getApiConfig(opts.baseURL, opts.connectionString);
    this.logger.debug("Testing if API is reachable", config);
    const driver = await engine.getApiDriver(config);
    try {
      const response = await driver.request({ method: "GET", url: "/_ping" });
      result.success = response?.data === "OK";
      result.details = response?.data || "Api reached";
    } catch (error) {
      result.details = "API is not reachable - start manually or connect";
      this.logger.error(
        "Reachability test failed",
        opts,
        error.message,
        error.response ? { code: error.response.status, statusText: error.response.statusText } : ""
      );
    }
    return result;
  }

  // cleanup
  async pruneSystem() {
    const currentEngine = await this.getCurrentEngine();
    return await currentEngine.pruneSystem();
  }

  async resetSystem() {
    const currentEngine = await this.getCurrentEngine();
    return await currentEngine.resetSystem();
  }

  // utilities
  async connectToContainer(opts) {
    const { id, title, shell } = opts || {};
    this.logger.debug("Connecting to container", opts);
    const currentEngine = await this.getCurrentEngine();
    const { program } = await currentEngine.getCurrentSettings();
    const { launcher, command } = await currentEngine.getScopedCommand(program.path, [
      "exec",
      "-it",
      id,
      shell || "/bin/sh"
    ]);
    this.logger.debug("Launching terminal for", { launcher, command });
    const output = await launchTerminal(launcher, command, {
      title: title || `${currentEngine.ADAPTER} container`
    });
    if (!output.success) {
      logger.error("Unable to connect to container", id, output);
    }
    return output.success;
  }

  async connectToMachine(opts) {
    const { name, title, shell } = opts || {};
    this.logger.debug("Connecting to machine", opts);
    const { currentEngine } = this;
    const { launcher, command } = await currentEngine.getScopedCommand("/bin/sh", []);
    this.logger.debug("Launching terminal for", { launcher, command });
    const output = await launchTerminal(launcher, command, {
      title: title || `${currentEngine.ADAPTER} machine`
    });
    if (!output.success) {
      logger.error("Unable to connect to machine", id, output);
    }
    return output.success;
  }

  async restartMachine(opts) {
    const stop = await this.stopMachine(opts);
    const start = await this.startMachine(opts);
    return start.success;
  }
  async startMachine({ Name }) {
    const currentEngine = await this.getCurrentEngine();
    const { program } = await currentEngine.getCurrentSettings();
    const check = await currentEngine.runScopedCommand(program.path, ["machine", "start", Name], {
      async: true
    });
    return check.success;
  }
  async stopMachine({ Name }) {
    const currentEngine = await this.getCurrentEngine();
    const { program } = await currentEngine.getCurrentSettings();
    const check = await currentEngine.runScopedCommand(program.path, ["machine", "stop", Name]);
    return check.success;
  }
  async removeMachine(opts) {
    const stopped = await stopMachine(opts);
    if (!stopped) {
      this.logger.warn("Unable to stop machine before removal");
      return false;
    }
    const currentEngine = await this.getCurrentEngine();
    const { program } = await currentEngine.getCurrentSettings();
    const check = await currentEngine.runScopedCommand(program.path, ["machine", "rm", opts.Name, "--force"]);
    return check.success;
  }
  async createMachine(opts) {
    const currentEngine = await this.getCurrentEngine();
    const { program } = await currentEngine.getCurrentSettings();
    const output = await currentEngine.runScopedCommand(program.path, [
      "machine",
      "init",
      "--cpus",
      opts.cpus,
      "--disk-size",
      opts.diskSize,
      "--memory",
      opts.ramSize,
      opts.name
    ]);
    if (!output.success) {
      logger.error("Unable to create machine", opts, output);
    }
    return output.success;
  }

  async generateKube(opts) {
    const currentEngine = await this.getCurrentEngine();
    const capable = currentEngine.ADAPTER === Podman.Adapter.ADAPTER;
    if (!capable) {
      logger.error("Current engine is not able to generate kube yaml", currentEngine.ADAPTER, Podman.Adapter.ADAPTER);
      return null;
    }
    const { program } = await currentEngine.getCurrentSettings();
    const result = await currentEngine.runScopedCommand(program.path, ["generate", "kube", opts.entityId]);
    if (!result.success) {
      logger.error("Unable to generate kube", opts, result);
    }
    return result;
  }

  async getPodLogs(opts) {
    const currentEngine = await this.getCurrentEngine();
    const { program } = await currentEngine.getCurrentSettings();
    const args = ["pod", "logs"];
    if (typeof opts.Tail !== "undefined") {
      args.push(`--tail=${opts.Tail}`);
    }
    args.push("-f", opts.Id);
    const result = await currentEngine.runScopedCommand(program.path, args);
    return result;
  }

  // STARTUP BEHAVIOR
  async getDescriptor() {
    let running = false;
    let provisioned = false;
    const currentConnector = this.currentConnector;
    if (currentConnector) {
      provisioned = currentConnector.availability.program;
      if (typeof currentConnector.availability.controller !== "undefined") {
        provisioned = currentConnector.availability.program && currentConnector.availability.controller;
      }
      running = currentConnector.availability.api;
    }
    return {
      environment: this.environment,
      version: this.version,
      platform: this.osType,
      provisioned,
      running,
      connectors: this.connectors,
      currentConnector,
      userSettings: await this.getGlobalUserSettings()
    };
  }

  static getDefaultDescriptor(opts) {
    // THIS MUST NEVER FAIL
    const osType = opts.osType;
    const version = opts.version;
    const environment = opts.environment;
    const defaultConnectorId =
      osType === "Linux" ? "engine.default.podman.native" : "engine.default.podman.virtualized";

    const configuration = new UserConfiguration(version, environment);

    return {
      environment: environment,
      version: version,
      platform: osType,
      provisioned: !!opts?.provisioned,
      running: !!opts?.provisioned,
      connectors: DEFAULT_CONNECTORS,
      currentConnector: DEFAULT_CONNECTORS.find((it) => it.id === defaultConnectorId),
      userSettings: {
        connector: {
          default: defaultConnectorId
        },
        logging: { level: "error" },
        minimizeToSystemTray: false,
        path: configuration.getStoragePath(),
        startApi: false
      }
    };
  }
}

module.exports = {
  Application
};
