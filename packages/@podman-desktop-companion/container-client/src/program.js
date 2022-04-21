const path = require("path");
const os = require("os");
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

class Backend {
  constructor(programName, osType) {
    this.programName = programName || "podman";
    this.osType = osType || this.getOperatingSystemType();
    this.engineStarterMap = {
      [ENGINE_NATIVE]: (opts) => this.startApiNative(opts),
      [ENGINE_REMOTE]: (opts) => this.startApiRemote(opts),
      [ENGINE_VIRTUALIZED]: (opts) => this.startApiVirtualized(opts),
      [ENGINE_SUBSYSTEM_LIMA]: (opts) => this.startApiSubsystemLIMA(opts),
      [ENGINE_SUBSYSTEM_WSL]: (opts) => this.startApiSubsystemWSL(opts)
    };
    this.apiDriver = null;
  }
  async getApiDriver() {
    if (!this.apiDriver) {
      const config = await this.getApiConfig();
      this.apiDriver = createApiDriver(config);
    }
    return this.apiDriver;
  }
  async getVirtualizationMachineName() {
    return "podman-machine-default";
  }
  async getVirtualizationMachineInfo() {
    const machine = await this.getVirtualizationMachineName();
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
  setOperatingSystemType(osType) {
    this.osType = osType;
  }
  getOperatingSystemType() {
    return this.osType || os.type();
  }
  async detectEngine() {
    let engine = ENGINE_VIRTUALIZED;
    // native, virtualized, subsystem.wsl, subsystem.lima
    switch (this.getOperatingSystemType()) {
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
  async getEngine(skipDetect) {
    let current = userSettings.get("engine", "");
    if (!current && !skipDetect) {
      // if not found and detection not skipped - try to detect
      current = await this.detectEngine();
      // if found - cache the value
      if (current) {
        await this.setEngine(current);
      }
    }
    return current;
  }
  async setEngine(value) {
    userSettings.set("engine", value);
    // when engine changes - engine dependent properties must be recomputed
    const nextProgramPath = await this.detectProgramPath();
    if (nextProgramPath) {
      await this.setProgramPath(nextProgramPath);
    }
    return value;
  }
  getProgramName() {
    return userSettings.get("program.name", this.programName);
  }
  setProgramName(value) {
    return userSettings.set("program.name", value);
  }
  async detectProgramPath() {
    const programName = await this.getProgramName();
    const engine = await this.getEngine();
    let result = { success: false, stdout: "" };
    switch (this.getOperatingSystemType()) {
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
          wrapper = { launcher: "limactl", args: ["shell", "podman"] };
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
  async getProgramPath(skipDetect) {
    let current = userSettings.get(`program.${this.getProgramName()}.path`, "");
    if (!current && !skipDetect) {
      // if not found and detection not skipped - try to detect
      current = await this.detectProgramPath();
      // if found - cache the value
      if (current) {
        this.setProgramPath(current);
      }
    }
    return current;
  }
  setProgramPath(value) {
    return userSettings.set(`program.${this.getProgramName()}.path`, value);
  }
  async detectProgramVersion() {
    const engine = await this.getEngine();
    let result;
    if (engine === "subsystem.lima") {
      result = await this.execProgram(["--version"]);
    } else {
      result = await this.execProgramNatively(["--version"]);
    }
    if (result.success) {
      return `${result.stdout}`.trim().split(" ")[2];
    }
    throw new Error("Unable to detect program version");
  }
  async getProgramVersion(skipDetect) {
    let current = "";
    if (!skipDetect) {
      // if detection not skipped - try to detect
      current = await this.detectProgramVersion();
    }
    return current;
  }
  async getApiSocketPath() {
    let socketPath = "/tmp/podman-desktop-companion-podman-rest-api.sock";
    const engine = await this.getEngine();
    const machine = await this.getVirtualizationMachineName();
    if (engine === ENGINE_VIRTUALIZED) {
      switch (this.getOperatingSystemType()) {
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
    }
    return socketPath;
  }
  async getDescriptor() {
    return {
      name: await this.getProgramName(),
      engine: await this.getEngine(),
      path: await this.getProgramPath(),
      version: await this.detectProgramVersion(),
      connection: await this.getApiSocketPath()
    };
  }
  // Check if the API is available
  async getIsApiRunning() {
    const engine = await this.getEngine();
    logger.debug(`Checking if ${engine} API is running - init`);
    let running = false;
    try {
      // Avoid calling the API when engine is virtualized but no machines are running
      const program = await this.getProgramName();
      if (program === "podman") {
        if (engine === "virtualized") {
          try {
            const machine = await this.getVirtualizationMachineInfo();
            if (!machine.Running) {
              return false;
            }
          } catch (error) {
            logger.error(`Checking if ${engine} API is running - fail`, error.message);
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
    const socketPath = await this.getApiSocketPath();
    const clientOpts = {
      retry: { count: 2, wait: 1000 },
      checkStatus: async () => await this.getIsApiRunning(),
      programPath: await this.getProgramPath(),
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
      const started = await this.startMachine(machine.Name);
      if (started) {
        apiListening = await this.getIsApiRunning();
      }
    }
    return apiListening;
  }
  async startApiSubsystemLIMA(opts) {
    logger.debug("Starting API - subsystem.lima");
    let apiListening = false;
    const proc = await exec_launcher("limactl", ["start", "podman"]);
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
  async getApiConfig() {
    const config = {
      timeout: 60000,
      socketPath: await this.getApiSocketPath(),
      baseURL: "http://d/v3.0.0/libpod",
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
      const engine = await this.getEngine();
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
    const engine = await this.getEngine();
    const osType = await this.getOperatingSystemType();
    const programName = await this.getProgramName();
    const programExec = osType === "Windows_NT" ? `${programName}.exe` : programName;
    let wrapper;
    if (engine === ENGINE_SUBSYSTEM_LIMA) {
      wrapper = { launcher: "limactl", args: ["shell", "podman"] };
    } else if (engine === ENGINE_VIRTUALIZED && osType == "Linux") {
      const machine = await this.getVirtualizationMachineName();
      wrapper = { launcher: "podman", args: ["machine", "ssh", machine] };
    }
    const result = await exec_launcher(programName, command, { wrapper });
    result.command = [programExec, ...command];
    return result;
  }
  async execProgramNatively(command, opts) {
    const osType = await this.getOperatingSystemType();
    const programName = await this.getProgramName();
    const programExec = osType === "Windows_NT" ? `${programName}.exe` : programName;
    const result = await exec_launcher(programName, command, opts);
    result.command = [programExec, ...command];
    return result;
  }
  // Public API
  async getSystemConnections() {
    const engine = await this.getEngine();
    let items = [];
    if (engine === ENGINE_SUBSYSTEM_LIMA) {
      logger.warn("No connections list support while using lima");
      return items;
    }
    const result = await this.execProgram(["system", "connection", "list", "--format", "json"]);
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
    let info = {};
    const result = await this.execProgram(["system", "info", "--format", "json"]);
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

  async getSystemEnvironment() {
    let running = false;
    try {
      running = await this.getIsApiRunning();
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
      machine: await this.getVirtualizationMachineName(),
      platform: await this.getOperatingSystemType(),
      connections,
      running,
      system,
      // provisioned
      // userConfiguration
    };
  }

  async getContainers() {
    let items = [];
    const result = await this.execProgram(["container", "list", "--format", "json"]);
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
    const result = await this.execProgram(["image", "list", "--format", "json"]);
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
    const result = await this.execProgram(["volume", "list", "--format", "json"]);
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
    const result = await this.execProgram(args);
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
    const result = await this.execProgram(["system", "reset", "--force", "--log-level=debug"]);
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
    const result = await this.execProgram(["machine", "list", "--noheading", "--format", format]);
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
    const output = await this.execProgramNatively([
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
    const output = await this.execProgramNatively(["machine", "stop", name]);
    if (!output.success) {
      logger.error("Unable to stop machine", name, output);
    }
    return output.success;
  }

  async startMachine(name) {
    const output = await this.execProgramNatively(["machine", "start", name], { detached: true });
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
    const output = await this.execProgramNatively(params);
    if (!output.success) {
      logger.error("Unable to remove machine", name, output);
    }
    return output.success;
  }

  // Connection
  async connectToContainer(nameOrId, shell) {
    const program = await this.getProgramPath();
    const output = await launchTerminal(program, ["exec", "-it", nameOrId, shell || "/bin/sh"]);
    if (!output.success) {
      logger.error("Unable to connect to container", nameOrId, output);
    }
    return output.success;
  }
  async connectToMachine(name) {
    const program = await this.getProgramPath();
    const output = await launchTerminal(program, ["machine", "ssh", name]);
    if (!output.success) {
      logger.error("Unable to connect to machine", name, output);
    }
    return output.success;
  }

  // API proxy
  async createApiRequest(options) {
    const driver = await this.getApiDriver();
    const result = await driver.request(options);
    return result;
  }
}

module.exports = {
  ENGINE_NATIVE,
  ENGINE_REMOTE,
  ENGINE_VIRTUALIZED,
  ENGINE_SUBSYSTEM_LIMA,
  ENGINE_SUBSYSTEM_WSL,
  Backend
};
