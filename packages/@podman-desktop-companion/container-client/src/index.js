const path = require("path");
const os = require("os");
const fs = require("fs");
// vendors
const axios = require("axios");
// project
const { launchTerminal } = require("@podman-desktop-companion/terminal");
const { axiosConfigToCURL } = require("@podman-desktop-companion/utils");
const { createLogger } = require("@podman-desktop-companion/logger");
const { exec_launcher, exec_service } = require("@podman-desktop-companion/executor");
const userSettings = require("@podman-desktop-companion/user-settings");
// local
const logger = createLogger("container-client.Backend");

const ENGINE_NATIVE = "native";
const ENGINE_REMOTE = "remote";
const ENGINE_VIRTUALIZED = "virtualized";
const ENGINE_SUBSYSTEM_LIMA = "subsystem.lima";
const ENGINE_SUBSYSTEM_WSL = "subsystem.wsl";
const ENGINE_DOCKER = "docker";

const PROGRAM_NAME_PODMAN = "podman";
const PROGRAM_NAME_DOCKER = "docker";

function createApiDriver(config) {
  const driver = axios.create({
    ...config,
    adapter: require("axios/lib/adapters/http")
  });
  // Configure http client logging
  // Add a request interceptor
  driver.interceptors.request.use(
    function (config) {
      logger.debug("[container-client] HTTP request", axiosConfigToCURL(config));
      return config;
    },
    function (error) {
      logger.error("[container-client] HTTP request error", error);
      return Promise.reject(error);
    }
  );
  // Add a response interceptor
  driver.interceptors.response.use(
    function (response) {
      logger.debug("[container-client] HTTP response", { status: response.status, statusText: response.statusText });
      return response;
    },
    function (error) {
      logger.error("[container-client] HTTP response error", error.message);
      return Promise.reject(error);
    }
  );
  return driver;
}

class Executor {
  static async execProgram(osType, engine, programName, machine, command) {
    const programExec = osType === "Windows_NT" ? `${programName}.exe` : programName;
    let wrapper;
    if (engine === ENGINE_SUBSYSTEM_LIMA) {
      wrapper = { launcher: "limactl", args: ["shell", PROGRAM_NAME_PODMAN] };
    } else if (engine === ENGINE_VIRTUALIZED && osType == "Linux") {
      wrapper = { launcher: PROGRAM_NAME_PODMAN, args: ["machine", "ssh", machine] };
    }
    const result = await exec_launcher(programName, command, { wrapper });
    result.command = [programExec, ...command];
    return result;
  }
  static async execProgramNatively(osType, programName, command, opts) {
    const programExec = osType === "Windows_NT" ? `${programName}.exe` : programName;
    const result = await exec_launcher(programName, command, opts);
    result.command = [programExec, ...command];
    return result;
  }
}

class Detector {
  constructor(osType) {
    this.osType = osType || os.type();
  }
  async detectEngine() {
    let engine = ENGINE_VIRTUALIZED;
    // native, virtualized, subsystem.wsl, subsystem.lima
    switch (this.osType) {
      case "Linux":
        engine = ENGINE_NATIVE;
        break;
      case "Darwin":
        // This is only if `podman` command is exposed to the CLI, otherwise LIMA or WSL need to be detected
        engine = ENGINE_VIRTUALIZED; // or "subsystem.lima" | "subsystem.wsl"
        break;
      default:
        break;
    }
    return engine;
  }
  async detectProgramName(engine) {
    let program = PROGRAM_NAME_PODMAN;
    if (engine === ENGINE_DOCKER) {
      program = PROGRAM_NAME_DOCKER;
    }
    return program;
  }
  async detectProgramPath(engine, programName) {
    let result = { success: false, stdout: "" };
    switch (this.osType) {
      case "Linux":
        result = await exec_launcher("which", [programName]);
        break;
      case "Windows_NT":
        // TODO: WSL wrapper
        result = await exec_launcher("where", [`${programName}.exe`]);
        break;
      case "Darwin":
        let wrapper;
        if (engine === ENGINE_SUBSYSTEM_LIMA) {
          wrapper = { launcher: "limactl", args: ["shell", PROGRAM_NAME_PODMAN] };
        }
        result = await exec_launcher("which", [programName], { wrapper });
        break;
      default:
        break;
    }
    if (result.success) {
      return result.stdout.trim();
    }
    return result.stdout;
  }
  async detectProgramVersion(engine, programName, machine) {
    let result;
    if (engine === ENGINE_SUBSYSTEM_LIMA) {
      result = await Executor.execProgram(this.osType, engine, programName, machine, ["--version"]);
    } else {
      result = await Executor.execProgramNatively(this.osType, programName, ["--version"]);
    }
    if (result.success) {
      return `${result.stdout}`.trim().split(" ")[2].replace(",", "");
    }
    logger.error("Unable to detect program version", result);
    return result;
  }
  async detectVirtualizationMachineName() {
    return "podman-machine-default";
  }
  async detectApiSocketPath(engine, machine) {
    let socketPath = "/tmp/podman-desktop-companion-podman-rest-api.sock";
    if (engine === ENGINE_VIRTUALIZED) {
      switch (this.osType) {
        case "Linux":
        case "Darwin":
          socketPath = path.join(process.env.HOME, ".local/share/containers/podman/machine", machine, "podman.sock");
          break;
        case "Windows_NT":
          socketPath = `//./pipe/${machine}`;
          break;
        default:
          break;
      }
    } else if (engine === ENGINE_SUBSYSTEM_LIMA) {
      socketPath = path.join(process.env.HOME, ".lima/podman/sock/podman.sock");
    } else if (engine === ENGINE_SUBSYSTEM_WSL) {
      // TODO: Not implemented
      socketPath = "";
    } else if (engine === ENGINE_DOCKER) {
      socketPath = this.osType === "Windows_NT" ? "//./pipe/docker_engine" : "/var/run/docker.sock";
    }
    logger.debug("API socket path for", engine, "is", socketPath);
    return socketPath;
  }
  async detect() {
    // Order is important
    const osType = await this.osType;
    const engine = await this.detectEngine();
    const programName = await this.detectProgramName(engine);
    const programPath = await this.detectProgramPath(engine, programName);
    const machine = await this.detectVirtualizationMachineName();
    const programVersion = await this.detectProgramVersion(engine, programName, machine);
    const apiSocketPath = await this.detectApiSocketPath(engine, machine);
    return {
      osType,
      engine,
      programName,
      programPath,
      programVersion,
      machine,
      apiSocketPath
    };
  }
}

// Abstract
class Backend {
  constructor() {
    this.detector = new Detector();
    this.engineStarterMap = {
      [ENGINE_NATIVE]: (opts) => this.startApiNative(opts),
      [ENGINE_REMOTE]: (opts) => this.startApiRemote(opts),
      [ENGINE_VIRTUALIZED]: (opts) => this.startApiVirtualized(opts),
      [ENGINE_SUBSYSTEM_LIMA]: (opts) => this.startApiSubsystemLIMA(opts),
      [ENGINE_SUBSYSTEM_WSL]: (opts) => this.startApiSubsystemWSL(opts),
      [ENGINE_DOCKER]: (opts) => this.startApiDocker(opts)
    };
    this.engineApiDriversMap = {};
  }

  // Finders - functions who's result will be cached upon detection
  async getVirtualizationMachineInfo() {
    const machine = await this.detector.detectVirtualizationMachineName();
    const result = await this.execProgramNatively(["machine", "list", "--noheading", "--format", "json"]);
    let info;
    if (result.success) {
      let machines = [];
      try {
        machines = result.stdout ? JSON.parse(result.stdout) : machines;
      } catch (error) {
        logger.error("Unable to decode machines info", error, result);
      }
      info = machines.find((it) => it.Name === machine);
    }
    return info;
  }
  async findEngine(forceDetect) {
    let current = userSettings.get("engine", undefined);
    if (forceDetect || typeof current === "undefined") {
      // Perform detection using cached values
      current = await this.detector.detectEngine();
      // Cache detection
      if (current) {
        await this.setEngine(current);
      }
    }
    return current;
  }
  async setEngine(value) {
    const current = userSettings.get("engine");
    const ret = userSettings.set("engine", value);
    if (current !== value) {
      logger.debug(`Engine change requested from ${current} to ${value} - forcing detections`);
      const programName = await this.findCurrentProgramName(true);
      const programPath = await this.findProgramPath(true);
      const version = await this.findProgramVersion();
      const apiSocketPath = await this.findApiSocketPath(true);
      logger.debug(`Engine change requested from ${current} to ${value} - detected`, {
        programName,
        programPath,
        version,
        apiSocketPath
      });
    }
    return ret;
  }
  async findCurrentProgramName(forceDetect) {
    let current = userSettings.get("program.current", undefined);
    if (forceDetect || typeof current === "undefined") {
      // Perform detection using cached values
      const engine = await this.findEngine();
      current = await this.detector.detectProgramName(engine);
      // Cache detection
      if (current) {
        await this.setCurrentProgramName(current);
      }
    }
    return current;
  }
  setCurrentProgramName(value) {
    return userSettings.set("program.current", value);
  }
  async findProgramPath(forceDetect) {
    const programName = await this.findCurrentProgramName();
    let current;
    if (programName) {
      current = userSettings.get(`program.${programName}.path`, undefined);
      if (forceDetect || typeof current === "undefined") {
        // Perform detection using cached values
        const engine = await this.findEngine();
        current = await this.detector.detectProgramPath(engine, programName);
        // Cache detection
        if (current) {
          await this.setProgramPath(current);
        }
      }
    } else {
      logger.error("Unable to find program path when no program is specified");
    }
    return current;
  }
  async setProgramPath(value) {
    const programName = await this.findCurrentProgramName();
    return userSettings.set(`program.${programName}.path`, value);
  }
  async findProgramVersion() {
    // Program version is not cached
    const engine = await this.findEngine();
    const programName = await this.findCurrentProgramName();
    const machine = await this.detector.detectVirtualizationMachineName();
    const current = await this.detector.detectProgramVersion(engine, programName, machine);
    return current;
  }
  async findProgram() {
    const name = await this.findCurrentProgramName();
    return {
      name,
      path: await this.findProgramPath(),
      currentVersion: await this.findProgramVersion(),
      title: name,
      homepage: `https://${name}.io`
    };
  }
  async findApiSocketPath(forceDetect) {
    const programName = await this.findCurrentProgramName();
    let current;
    if (programName) {
      current = userSettings.get(`program.${programName}.socketPath`, undefined);
      if (forceDetect || typeof current === "undefined") {
        // Perform detection using cached values
        const engine = await this.findEngine();
        const machine = await this.detector.detectVirtualizationMachineName();
        current = await this.detector.detectApiSocketPath(engine, machine);
        // Cache detection
        if (current) {
          await this.setApiSocketPath(current);
        }
      }
    } else {
      logger.error("Unable to find api socket path when no program is specified");
    }
    return current;
  }
  async setApiSocketPath(value) {
    const programName = await this.findCurrentProgramName();
    return userSettings.set(`program.${programName}.socketPath`, value);
  }
  async findApiBaseURL(forceDetect) {
    const engine = await this.findEngine();
    return engine === ENGINE_DOCKER ? "http://localhost" : "http://d/v3.0.0/libpod";
  }

  // Helper methods

  async getApiDriver() {
    const engine = await this.findEngine();
    if (!this.engineApiDriversMap[engine]) {
      const config = await this.getApiConfig();
      this.engineApiDriversMap[engine] = createApiDriver(config);
    }
    return this.engineApiDriversMap[engine];
  }

  async getIsApiRunning() {
    const osType = this.detector.osType;
    const engine = await this.findEngine();
    logger.debug(`Checking if ${engine} API is running - init`);
    let running = false;
    try {
      // Avoid calling the API when engine is virtualized but no machines are running
      const program = await this.findCurrentProgramName();
      if (program === PROGRAM_NAME_PODMAN) {
        if (engine === "virtualized") {
          try {
            const machine = await this.getVirtualizationMachineInfo();
            if (!machine.Running) {
              logger.error(`Checking if ${engine} API is running - fail`, "Machine is not running");
              return false;
            }
          } catch (error) {
            logger.error(`Checking if ${engine} API is running - fail`, error.message);
          }
        }
        // Check if the socket path exists
        // TODO: Check if it makes sense on Windows
        if (osType !== "Windows_NT") {
          const socketPath = await this.findApiSocketPath();
          if (!fs.existsSync(socketPath)) {
            const connector = osType === "Windows_NT" ? "Named pipe" : "Socket file";
            logger.error(`Checking if ${engine} API is running - fail`, `${connector} not present in ${socketPath}`);
            return false;
          }
        }
      }
      // Call the API _ping service
      const driver = await this.getApiDriver();
      const result = await driver.get("/_ping");
      running = result?.data === "OK";
      logger.debug(`Checking if ${engine} API is running - done`, running);
    } catch (error) {
      logger.error(`Checking if ${engine} API is running - fail`, error.message);
    }
    return running;
  }
  // Start the required API
  async startApiNative(opts) {
    logger.debug("Starting API - native");
    let socketPath = await this.findApiSocketPath();
    socketPath = socketPath.replace("unix://", ""); // ensure no scheme prefix present
    const clientOpts = {
      retry: { count: 2, wait: 1000 },
      checkStatus: async () => await this.getIsApiRunning(),
      programPath: await this.findProgramPath(),
      programArgs: ["system", "service", "--time=0", `unix://${socketPath}`, "--log-level=debug"],
      ...(opts || {})
    };
    logger.debug("System service start requested", clientOpts);
    const client = await exec_service(clientOpts);
    return new Promise((resolve, reject) => {
      client.on("close", ({ code }) => {
        logger.debug("Closed", code);
      });
      client.on("ready", async ({ process }) => {
        try {
          logger.debug("System service start read", process);
          this.nativeApiStarterProcess = process;
          resolve(true);
        } catch (error) {
          logger.error("System service ready error", error.message, error.stack);
          reject(error);
        }
      });
      client.on("error", (info) => {
        logger.error("Process error", info);
        reject(new Error("Unable to start system service"));
      });
    });
  }
  async startApiRemote(opts) {
    logger.debug("Starting API - remote");
    // TODO: Not implemented
    throw new Error("Not implemented");
  }
  async startApiVirtualized(opts) {
    logger.debug("Starting API - virtualized");
    let apiListening = false;
    const machine = await this.getVirtualizationMachineInfo();
    if (machine.Running) {
      apiListening = await this.getIsApiRunning();
    } else {
      const output = await this.execProgramNatively(["machine", "start", machine.Name], { detached: true });
      const started = output.success;
      if (started) {
        apiListening = await this.getIsApiRunning();
      }
    }
    return apiListening;
  }
  async startApiSubsystemLIMA(opts) {
    logger.debug("Starting API - subsystem.lima");
    let apiListening = false;
    const proc = await exec_launcher("limactl", ["start", PROGRAM_NAME_PODMAN]);
    if (proc.success && proc.code === 0) {
      apiListening = await this.getIsApiRunning();
    }
    return apiListening;
  }
  async startApiSubsystemWSL(opts) {
    logger.debug("Starting API - subsystem.wsl");
    // TODO: Not implemented
    throw new Error("Not implemented");
  }
  async startApiDocker(opts) {
    logger.debug("Starting API - docker");
    return Promise.resolve(true);
  }
  async getApiConfig(customSocketPath) {
    const config = {
      timeout: 60000,
      socketPath: customSocketPath || (await this.findApiSocketPath()),
      baseURL: await this.findApiBaseURL(),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      }
    };
    logger.debug("API configuration", config);
    return config;
  }
  async startApi(opts) {
    // Check if started
    let isRunning = await this.getIsApiRunning();
    // Skip if started
    if (!isRunning) {
      const engine = await this.findEngine();
      const starter = this.engineStarterMap[engine];
      if (!starter) {
        throw new Error(`No API starter available for ${engine} engine`);
      }
      logger.debug("Starting API - using starter", opts);
      isRunning = await starter(opts);
    }
    return isRunning;
  }
  async execProgram(command) {
    const osType = this.detector.osType;
    const engine = await this.findEngine();
    const programName = await this.findCurrentProgramName();
    const machine = await this.detector.detectVirtualizationMachineName();
    const result = await Executor.execProgram(osType, engine, programName, machine, command);
    return result;
  }
  async execProgramNatively(command, opts) {
    const osType = this.detector.osType;
    const programName = await this.findCurrentProgramName();
    const result = await Executor.execProgramNatively(osType, programName, command);
    return result;
  }
  // API proxy
  async createApiRequest(options) {
    const driver = await this.getApiDriver();
    const result = await driver.request(options);
    return result;
  }
  // API test
  async testApiReachability({ socketPath }) {
    const result = {
      success: false,
      details: undefined
    };
    const config = await this.getApiConfig(socketPath);
    const driver = createApiDriver(config);
    try {
      const response = await driver.get("/_ping");
      result.success = response?.data === "OK";
      result.details = response?.data;
    } catch (error) {
      result.details = error.message;
    }
    return result;
  }
}

class ContainerClient {
  constructor(backend) {
    this.backend = backend;
  }
  async getSystemEnvironment() {
    throw new Error("Not implemented");
  }
  async getSystemConnections() {
    throw new Error("Not implemented");
  }
  async getSystemInfo() {
    throw new Error("Not implemented");
  }
  async getContainers() {
    throw new Error("Not implemented");
  }
  async getImages() {
    throw new Error("Not implemented");
  }
  async getVolumes() {
    throw new Error("Not implemented");
  }
  async pruneSystem() {
    throw new Error("Not implemented");
  }
  async resetSystem() {
    throw new Error("Not implemented");
  }
  async getMachines() {
    throw new Error("Not implemented");
  }
  async createMachine(opts) {
    throw new Error("Not implemented");
  }
  async stopMachine(name) {
    throw new Error("Not implemented");
  }
  async startMachine(name) {
    throw new Error("Not implemented");
  }
  async restartMachine(name) {
    throw new Error("Not implemented");
  }
  async removeMachine(name, force) {
    throw new Error("Not implemented");
  }
  async connectToContainer(nameOrId, shell) {
    throw new Error("Not implemented");
  }
  async connectToMachine(name) {
    throw new Error("Not implemented");
  }
}

class PodmanClient extends ContainerClient {
  async getSystemEnvironment() {
    let running = false;
    try {
      running = await this.backend.getIsApiRunning();
    } catch (error) {
      logger.error("Unable to obtain running status", error);
    }
    let connections = [];
    try {
      connections = running ? await this.getSystemConnections() : [];
    } catch (error) {
      logger.error("Unable to obtain system connections list", error);
    }
    let system = null;
    try {
      system = await this.getSystemInfo();
    } catch (error) {
      logger.error("Unable to obtain system info", error);
    }
    return {
      machine: await this.backend.detector.detectVirtualizationMachineName(),
      platform: this.backend.detector.osType,
      connections,
      running,
      system
      // provisioned
      // userConfiguration
    };
  }

  async getSystemConnections() {
    const engine = await this.backend.findEngine();
    let items = [];
    if (engine === ENGINE_SUBSYSTEM_LIMA) {
      logger.warn("No connections list support while using lima");
      return items;
    }
    const result = await this.backend.execProgram(["system", "connection", "list", "--format", "json"]);
    if (!result.success) {
      logger.error("Unable to get list of connections", result);
      return items;
    }
    try {
      items = result.stdout ? JSON.parse(result.stdout) : items;
    } catch (error) {
      logger.error("Unable to decode list of connections", error, result);
    }
    return items;
  }

  async getSystemInfo() {
    let info;
    const result = await this.backend.execProgram(["system", "info", "--format", "json"]);
    if (!result.success) {
      logger.error("Unable to get system info", result);
      return info;
    }
    try {
      info = result.stdout ? JSON.parse(result.stdout) : info;
    } catch (error) {
      logger.error("Unable to decode system info", error, result);
    }
    return info;
  }

  async getContainers() {
    let items = [];
    const result = await this.backend.execProgram(["container", "list", "--format", "json"]);
    if (!result.success) {
      logger.error("Unable to get list of containers", result);
      return items;
    }
    try {
      items = JSON.parse(result.stdout);
    } catch (error) {
      logger.error("Unable to decode list of containers", error, result);
    }
    return items;
  }

  async getImages() {
    let items = [];
    const result = await this.backend.execProgram(["image", "list", "--format", "json"]);
    if (!result.success) {
      logger.error("Unable to get list of images", result);
      return items;
    }
    try {
      items = JSON.parse(result.stdout);
    } catch (error) {
      logger.error("Unable to decode list of images", error, result);
    }
    return items;
  }

  async getVolumes() {
    let items = [];
    const result = await this.backend.execProgram(["volume", "list", "--format", "json"]);
    if (!result.success) {
      logger.error("Unable to get list of volumes", result);
      return items;
    }
    try {
      items = JSON.parse(result.stdout);
    } catch (error) {
      logger.error("Unable to decode list of volumes", error, result);
    }
    return items;
  }

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
      args.push("-all");
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
    const result = await this.backend.execProgram(args);
    if (!result.success) {
      logger.error("System prune error", result);
      throw new Error("System prune error");
    }
    logger.debug("System prune complete");
    // TODO: Implement result as the REST api
    const report = {
      ContainerPruneReports: null,
      ImagePruneReports: null,
      PodPruneReport: null,
      ReclaimedSpace: -1,
      VolumePruneReports: null
    };
    logger.debug("System report complete", report);
    return report;
  }

  async resetSystem() {
    const result = await this.backend.execProgram(["system", "reset", "--force", "--log-level=debug"]);
    if (!result.success) {
      logger.error("System reset error", result);
      throw new Error("System reset error");
    }
    logger.debug("System reset complete");
    const report = {
      containers: await this.getContainers(),
      images: await this.getImages(),
      machines: await this.getMachines(),
      volumes: await this.getVolumes()
    };
    logger.debug("System report complete", report);
    return report;
  }

  async getMachines() {
    let items = [];
    const format = "{{.Name}}|{{.VMType}}|{{.Running}}|{{.Created}}|{{.LastUp}}|{{.CPUs}}|{{.Memory}}|{{.DiskSize}}\\n";
    const result = await this.backend.execProgram(["machine", "list", "--noheading", "--format", format]);
    if (!result.success) {
      logger.error("Unable to get list of podman machines", result);
      return items;
    }
    items = result.stdout
      .split("\n")
      .filter((it) => !!it)
      .map((info) => {
        const fields = info.split("|");
        const [NameInfo, VMType, Created, LastUp, CPUs, Memory, DiskSize] = fields;
        const Name = NameInfo.replace(/\*/g, "");
        return {
          Name,
          Active: NameInfo.indexOf("*") !== -1,
          Running: LastUp === "Currently running",
          VMType,
          Created,
          LastUp,
          CPUs: Number(CPUs),
          Memory,
          DiskSize
        };
      });
    return items;
  }

  async createMachine(opts) {
    const output = await this.backend.execProgramNatively([
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

  async stopMachine(name) {
    const output = await this.backend.execProgramNatively(["machine", "stop", name]);
    if (!output.success) {
      logger.error("Unable to stop machine", name, output);
    }
    return output.success;
  }

  async startMachine(name) {
    const output = await this.backend.execProgramNatively(["machine", "start", name], { detached: true });
    if (!output.success) {
      logger.error("Unable to start machine", name, output);
    }
    return output.success;
  }

  async restartMachine(name) {
    const stoppedOutput = await this.stopMachine(name);
    const startedOutput = await this.startMachine(name);
    return stoppedOutput.success && startedOutput.success;
  }

  async removeMachine(name, force) {
    const stoppedOutput = await this.stopMachine(name);
    if (!stoppedOutput.success) {
      logger.warn("Unable to stop machine before removal", stoppedOutput);
    }
    const params = ["machine", "rm", name];
    if (force) {
      params.push("--force");
    }
    const output = await this.backend.execProgramNatively(params);
    if (!output.success) {
      logger.error("Unable to remove machine", name, output);
    }
    return output.success;
  }

  // Connection
  async connectToContainer(nameOrId, shell) {
    const program = await this.backend.findProgramPath();
    const output = await launchTerminal(program, ["exec", "-it", nameOrId, shell || "/bin/sh"]);
    if (!output.success) {
      logger.error("Unable to connect to container", nameOrId, output);
    }
    return output.success;
  }
  async connectToMachine(name) {
    const program = await this.backend.findProgramPath();
    const output = await launchTerminal(program, ["machine", "ssh", name]);
    if (!output.success) {
      logger.error("Unable to connect to machine", name, output);
    }
    return output.success;
  }
}

class DockerClient extends ContainerClient {
  async getSystemEnvironment() {
    let running = false;
    try {
      running = await this.backend.getIsApiRunning();
    } catch (error) {
      logger.error("Unable to obtain running status", error);
    }
    let connections = [];
    try {
      connections = running ? await this.getSystemConnections() : [];
    } catch (error) {
      logger.error("Unable to obtain system connections list", error);
    }
    let system = null;
    try {
      system = await this.getSystemInfo();
      if (system) {
        // API alignment with libpod
        system.host = system.host || {};
        system.host.os = system.OperatingSystem;
        system.host.kernel = system.KernelVersion;
        system.host.hostname = system.Name;
        system.host.distribution = {
          distribution: system.OperatingSystem,
          variant: system.OSType,
          version: system.OSVersion
        };
      }
    } catch (error) {
      logger.error("Unable to obtain system info", error);
    }
    return {
      machine: "NOT SUPPORTED",
      platform: this.backend.detector.osType,
      connections,
      running,
      system
      // provisioned
      // userConfiguration
    };
  }
  async getSystemConnections() {
    logger.warn("Docker client does not support system connections");
    return Promise.resolve([]);
  }

  async getSystemInfo() {
    let info;
    const result = await this.backend.execProgram(["system", "info", "--format", "{{json .}}"]);
    if (!result.success) {
      logger.error("Unable to get system info", result);
      return info;
    }
    try {
      info = result.stdout ? JSON.parse(result.stdout) : info;
    } catch (error) {
      logger.error("Unable to decode system info", error, result);
    }
    return info;
  }

  async getMachines() {
    logger.warn("Docker client does not support machines");
    return Promise.resolve([]);
  }
}

module.exports = {
  ENGINE_NATIVE,
  ENGINE_REMOTE,
  ENGINE_VIRTUALIZED,
  ENGINE_SUBSYSTEM_LIMA,
  ENGINE_SUBSYSTEM_WSL,
  ENGINE_DOCKER,
  createApiDriver,
  Detector,
  Backend,
  PodmanClient,
  DockerClient
};
