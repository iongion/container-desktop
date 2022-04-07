const os = require("os");
const fs = require("fs");
const path = require("path");
// vendors
const axios = require("axios");
const logger = require("electron-log");
const electronConfig = require("electron-cfg");
// project
const { axiosConfigToCURL } = require("@podman-desktop-companion/utils");
// local
const { exec, exec_launcher, withClient } = require("@podman-desktop-companion/executor");
const { launchTerminal } = require("@podman-desktop-companion/terminal");

class ResultError extends Error {
  constructor(message, data, warnings) {
    super(message);
    this.name = "ResultError";
    this.response = { data: data || message, warnings: warnings || [] };
  }
}

function detectEngine() {
  let engine = "remote";
  switch (os.type()) {
    case "Linux":
      engine = "native";
      break;
    case "Windows_NT":
      engine = "virtualized";
      break;
    case "Darwin":
      engine = "virtualized";
      break;
    default:
      break;
  }
  return engine;
}

function getEngine() {
  return electronConfig.get("engine", detectEngine());
}

function setEngine(value) {
  const engine = value || getEngine();
  electronConfig.set("engine", engine);
  return engine;
}

function getProgramName() {
  return "podman";
}

function getProgramKey(program) {
  return `program.${program}.path`;
}

async function getProgramPath() {
  const program = getProgramName();
  const programKey = getProgramKey(program);
  let programPath = electronConfig.get(programKey);
  if (programPath) {
    // logger.debug(`Program ${program} found in ${programPath} - cache hit`);
  } else {
    logger.debug(`Program ${program} not found in ${programPath} - cache miss(detecting)`);
    let result = { success: false, stdout: "" };
    switch (os.type()) {
      case "Linux":
        result = await exec("which", [program]);
        break;
      case "Windows_NT":
        result = await exec_launcher("where", [`${program}.exe`]);
        break;
      case "Darwin":
        result = await exec_launcher("which", [program]);
        break;
      default:
        break;
    }
    if (result.success) {
      programPath = result.stdout.trim();
    }
    // Cache if found
    if (programPath) {
      logger.debug(`Program ${program} found in ${programPath} - cache miss(storing)`);
      await setProgramPath(program, programPath);
    } else {
      logger.error(`Program ${program} not found - missing dependency`);
    }
  }
  return programPath;
}

async function setProgramPath(program, programPath) {
  // TODO: Validate the program before configuring it
  const programKey = getProgramKey(program);
  electronConfig.set(programKey, programPath);
  return true;
}

async function execProgram(args) {
  const program = await getProgramPath();
  if (!program) {
    throw new Error("No program specified");
  }
  const output = await exec(program, args);
  return output;
}

async function getSystemConnections() {
  let items = [];
  const output = await execProgram(["system", "connection", "list", "--format", "json"]);
  if (!output.success) {
    logger.error("Unable to get list of podman connections", output);
    return items;
  }
  try {
    items = output.stdout ? JSON.parse(output.stdout) : items;
  } catch (error) {
    logger.error("Unable to decode list of podman connections", error);
  }
  return items;
}

async function getSystemInfo() {
  let items = {};
  const output = await execProgram(["system", "info", "--format", "{{json .}}"]);
  if (!output.success) {
    logger.error("Unable to get podman system information", output);
    return items;
  }
  try {
    items = output.stdout ? JSON.parse(output.stdout) : items;
  } catch (error) {
    logger.error("Unable to decode podman system information", error);
  }
  return items;
}

function getCurrentMachine() {
  // TODO: Choose machine
  let machine;
  machine = "podman-machine-default";
  return machine;
}

function getCurrentMachineNamedPipeApiSocketPath() {
  return `//./pipe/${getCurrentMachine()}`;
}

function getCurrentMachineUnixApiSocketPath() {
  return path.join(process.env.HOME, ".local/share/containers/podman/machine", getCurrentMachine(), "podman.sock");
}

function getNativeUnixApiSocketFile() {
  return "/tmp/podman-desktop-companion-podman-rest-api.sock";
}

function getApiSocketPath() {
  let socketPath = getNativeUnixApiSocketFile();
  if (getEngine() === "virtualized") {
    switch (os.type()) {
      case "Linux":
      case "Darwin":
        socketPath = getCurrentMachineUnixApiSocketPath();
        break;
      case "Windows_NT":
        socketPath = getCurrentMachineNamedPipeApiSocketPath();
        break;
      default:
        break;
    }
  }
  return socketPath;
}

function getApiConfig() {
  const config = {
    timeout: 30000,
    socketPath: getApiSocketPath(),
    baseURL: "/v3.0.0/libpod",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    adapter: require("axios/lib/adapters/http")
  };
  console.debug("API configuration", config);
  return config;
}

function getApiDriver(cfg) {
  const config = cfg || getApiConfig();
  const driver = axios.create(config);
  // Configure http client logging
  // Add a request interceptor
  driver.interceptors.request.use(
    function (config) {
      // logger.debug("HTTP request", axiosConfigToCURL(config));
      return config;
    },
    function (error) {
      logger.error("HTTP request error", error);
      return Promise.reject(error);
    }
  );
  // Add a response interceptor
  driver.interceptors.response.use(
    function (response) {
      // logger.debug("HTTP response", response);
      return response;
    },
    function (error) {
      logger.error("HTTP response error", error.message, error.stack);
      return Promise.reject(error);
    }
  );
  return driver;
}

async function getGithubRepoTags(owner, repo) {
  const url = `https://api.github.com/repos/${owner}/${repo}/tags`;
  let data = [];
  const cachePath = path.join(path.dirname(__dirname), `github-repo-${owner}-${repo}-cache.json`);
  if (fs.existsSync(cachePath)) {
    data = JSON.parse(fs.readFileSync(cachePath).toString());
  } else {
    try {
      const result = await axios.get(url);
      data = result.data.map((tag) => tag.name.substring(1)).filter((tag) => tag.indexOf("-rc") === -1);
      fs.writeFileSync(cachePath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error("Unable to retrieve repo tags", url);
    }
  }
  return data;
}

async function getContainers() {
  let items = [];
  const output = await execProgram(["container", "list", "--format", "json"]);
  if (!output.success) {
    logger.error("Unable to get list of podman containers", output);
    return items;
  }
  try {
    items = JSON.parse(output.stdout);
  } catch (error) {
    logger.error("Unable to decode list of podman containers", error);
  }
  return items;
}

async function connectToContainer(nameOrId, shell) {
  const program = await getProgramPath();
  const output = await launchTerminal(program, ["exec", "-it", nameOrId, shell || "/bin/sh"]);
  if (!output.success) {
    logger.error("Unable to connect to container", nameOrId, output);
  }
  return output.success;
}

async function getImages() {
  let items = [];
  const output = await execProgram(["image", "list", "--format", "json"]);
  if (!output.success) {
    logger.error("Unable to get list of podman images", output);
    return items;
  }
  try {
    items = JSON.parse(output.stdout);
  } catch (error) {
    logger.error("Unable to decode list of podman images", error);
  }
  return items;
}

async function getMachines() {
  let items = [];
  const format = "{{.Name}}|{{.VMType}}|{{.Created}}|{{.LastUp}}|{{.CPUs}}|{{.Memory}}|{{.DiskSize}}\\n";
  const output = await execProgram(["machine", "list", "--noheading", "--format", format]);
  if (!output.success) {
    logger.error("Unable to get list of podman machines", output);
    return items;
  }
  items = output.stdout
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

async function createMachine(opts) {
  const output = await execProgram([
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

async function connectToMachine(name) {
  const program = await getProgramPath();
  const output = await launchTerminal(program, ["machine", "ssh", name]);
  if (!output.success) {
    logger.error("Unable to connect to machine", name, output);
  }
  return output.success;
}

async function stopMachine(name) {
  const output = await execProgram(["machine", "stop", name]);
  if (!output.success) {
    logger.error("Unable to stop machine", name, output);
  }
  return output.success;
}

async function startMachine(name) {
  const output = await execProgram(["machine", "start", name]);
  if (!output.success) {
    logger.error("Unable to start machine", name, output);
  }
  return output.success;
}

async function restartMachine(name) {
  const stoppedOutput = await stopMachine(name);
  const startedOutput = await startMachine(name);
  return stoppedOutput.success && startedOutput.success;
}

async function removeMachine(name, force) {
  const stoppedOutput = await stopMachine(name);
  if (!stoppedOutput.success) {
    logger.warn("Unable to stop machine before removal", stoppedOutput);
  }
  const params = ["machine", "rm", name];
  if (force) {
    params.push("--force");
  }
  const output = await execProgram(params);
  if (!output.success) {
    logger.error("Unable to remove machine", name, output);
  }
  return output.success;
}

async function getVolumes() {
  let items = [];
  const output = await execProgram(["volume", "list", "--format", "json"]);
  if (!output.success) {
    logger.error("Unable to get list of podman volumes", output);
    return items;
  }
  try {
    items = JSON.parse(output.stdout);
  } catch (error) {
    logger.error("Unable to decode list of podman volumes", error);
  }
  return items;
}

async function getPodmanProgram(customPath) {
  let programVersion;
  let programName = "podman";
  let programTitle = "Podman";
  const programPath = customPath ? customPath : await getProgramPath();
  if (programPath) {
    const programVersionInfo = await execProgram(["--version"]);
    if (programVersionInfo.success) {
      const parts = programVersionInfo.stdout.split(",")[0].split(" ");
      programVersion = parts[2] ? parts[2].trim() : undefined;
      programName = programPath.split(path.sep).pop() || programName;
      programTitle = parts[0] || programTitle;
    }
  }
  const program = {
    name: programName,
    path: programPath,
    currentVersion: programVersion,
    title: programTitle,
    homepage: `https://${programName}.io`,
    platform: os.type()
  };
  logger.debug("Detected program", program);
  return program;
}

async function getProgram(name) {
  switch (name) {
    case "podman":
      return getPodmanProgram();
    default:
      break;
  }
}

// Container engine specific
async function startApi(opts) {
  if (getEngine() === "native") {
    logger.debug("Starting native engine with system service");
    return startSystemService(opts);
  }
  const machine = getCurrentMachine();
  logger.debug("Starting virtualized engine with machine", machine);
  const success = await startMachine(machine);
  if (success) {
    logger.debug("API virtualized engine started with machine", machine);
    const program = await getProgram("podman");
    const systemApiResult = { data: null }; //await getApiDriver().get("/info");
    const running = await isApiRunning();
    return {
      program,
      system: systemApiResult.data,
      running
    };
  }
  logging.error("API virtualized engine startup failure with machine", machine);
  throw new ResultError("Unable to start machine", machine);
}

async function startSystemService(opts) {
  const clientOpts = {
    socketPath: getApiSocketPath(),
    retry: { count: 2, wait: 1000 },
    checkStatus: isApiRunning,
    programPath: await getProgramPath(),
    ...(opts || {})
  };
  logger.debug("System service start requested", clientOpts);
  const client = await withClient(clientOpts);
  return new Promise((resolve, reject) => {
    client.on("close", ({ code, connect }) => {
      logger.debug("Closed", code);
      // setTimeout(() => {
      //   client.emit('start');
      // }, 1000)
    });
    client.on("ready", async ({ process }) => {
      try {
        logger.debug("System service start read", process);
        const program = await getProgram("podman");
        const systemApiResult = await getApiDriver().get("/info");
        const running = await isApiRunning();
        resolve({
          program,
          system: systemApiResult.data,
          running
        });
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

async function getSystemEnvironment() {
  let connections = [];
  try {
    connections = await getSystemConnections();
  } catch (error) {
    logger.error("Unable to obtain system connections list", error);
  }
  let running = false;
  try {
    running = await isApiRunning();
  } catch (error) {
    logger.error("Unable to obtain running status", error);
  }
  let system = {};
  try {
    system = await getSystemInfo();
  } catch (error) {
    logger.error("Unable to obtain system info", error);
  }
  let program;
  try {
    program = await getProgram("podman");
  } catch (error) {
    logger.error("Unable to obtain program information", error);
  }
  const platform = os.type();
  return {
    platform,
    connections,
    program,
    running,
    system,
    // connection type of client
    engine: getEngine()
  };
}

async function isApiRunning(driver) {
  logger.debug("Checking if API is running - init");
  let running = false;
  const apiDriver = driver || getApiDriver();
  try {
    const result = await apiDriver.get("/_ping");
    running = result?.data === "OK";
    logger.debug("Checking if API is running - done", running);
  } catch (error) {
    logger.error("Checking if API is running - fail", error.message);
  }
  return running;
}

async function resetSystem() {
  const status = await execProgram(["system", "reset", "--force", "--log-level=debug"]);
  if (!status.success) {
    logger.error("System reset error", status);
    throw new Error("System reset error");
  }
  logger.debug("System reset complete");
  const report = {
    containers: await getContainers(),
    images: await getImages(),
    machines: await getMachines(),
    volumes: await getVolumes()
  };
  logger.debug("System report complete", report);
  return report;
}

async function getWSLDistributions() {
  // const result = await exec_launcher("cmd.exe", ["/c", ["chcp", "65001", ">> nul", "&&", "wsl.exe", "--list", "--quiet"].join(" ")]);
  // see https://stackoverflow.com/questions/67746179/how-do-i-match-on-wsl-output-in-powershell
  const result = await exec_launcher("powershell.exe", [
    "-command",
    '(wsl --list --running --quiet) -replace "`0" | Select-String -Pattern "."'
  ]);
  if (result.success) {
    const items = `${result.stdout}`
      .split("\r\n")
      .map((it) => {
        return {
          name: it.trim()
        };
      })
      .filter((it) => !!it.name);
    return items;
  }
  logger.error("Distributions list error", result);
  throw new ResultError("Unable to list distributions", result.stderr || result.stdout);
}

module.exports = {
  ResultError,
  getEngine,
  setEngine,
  getProgramPath,
  setProgramPath,
  getGithubRepoTags,
  getSystemConnections,
  getSystemInfo,
  getApiSocketPath,
  getApiConfig,
  getApiDriver,
  getContainers,
  getImages,
  getMachines,
  createMachine,
  connectToContainer,
  connectToMachine,
  startMachine,
  stopMachine,
  restartMachine,
  removeMachine,
  getVolumes,
  getProgram,
  startApi,
  startSystemService,
  getSystemEnvironment,
  isApiRunning,
  resetSystem,
  getWSLDistributions
};
