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

const isWSL = () => electronConfig.get('engine', '') ===  "virtualized.wsl";
const isLIMA = () => electronConfig.get('engine', '') ===  "virtualized.lima";

class ResultError extends Error {
  constructor(message, data, warnings) {
    super(message);
    this.name = "ResultError";
    this.response = { data: data || message, warnings: warnings || [] };
  }
}

// electronConfig.set('engine', 'virtualized.lima');

function getEngine() {
  let engine = "remote";
  if (os.type() === 'Linux') {
    engine = 'native';
  } else if (isWSL()) {
    engine = 'virtualized.wsl';
  } else if (isLIMA()) {
    engine = 'virtualized.lima';
  }
  return electronConfig.get('engine', engine);
}

function setEngine(value) {
  const engine = value || getEngine();
  electronConfig.set('engine', engine);
  return engine;
}

async function getProgramPath() {
  let programPath; // = electronConfig.get("program.path");
  if (programPath) {
    logger.debug("Configured program found", programPath);
  } else {
    logger.debug("No configured program found - detecting");
    let result = { success: false, stdout: '' };
    switch (os.type()) {
      case 'Linux':
        result = await exec("which", ["podman"]);
        break;
      case 'Windows_NT':
        result = isWSL() ? await exec("which", ["podman"], { useWSL: true }) : await exec_launcher("where", ["podman.exe"]);
        break;
      case 'Darwin':
        result = isLIMA() ? await exec("which", ["podman"], { useLIMA: true }) : await exec_launcher("which", ["podman"]);
        break;
      default:
        break;
    }
    if (result.success) {
      programPath = result.stdout.trim();
    }
    // Cache if found
    if (programPath) {
      logger.debug("Program found in", programPath);
      // await setProgramPath(programPath);
    } else {
      logger.error("No program at all");
    }
  }
  return programPath;
}

async function setProgramPath(nextProgramPath) {
  // TODO: Validate the program before configuring it
  electronConfig.set("program.path", nextProgramPath);
  return true;
}

async function execProgram(args) {
  const program = await getProgramPath();
  if (!program) {
    throw new Error("No program specified");
  }
  const output = await exec(program, args, { useWSL: isWSL(), useLIMA: isLIMA() });
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

function getApiUnixSocketPath() {
  if (isLIMA()) {
    return path.join(process.env.HOME, ".lima/podman/sock/podman.sock");
  }
  return "/tmp/podman.sock";
}

function getApiConfig() {
  return {
    timeout: 30000,
    socketPath: getApiUnixSocketPath(),
    baseURL: "/v3.0.0/libpod",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    adapter: require("axios/lib/adapters/http")
  };
}

function getApiDriver(cfg) {
  const config = cfg || getApiConfig();
  const driver = axios.create(config);
  // Configure http client logging
  // Add a request interceptor
  driver.interceptors.request.use(
    function (config) {
      logger.debug("HTTP request", axiosConfigToCURL(config));
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
    case "lima":
      return getLimaProgram();
    default:
      break;
  }
}

// Container engine specific
async function startSystemService(opts) {
  const clientOpts = {
    socketPath: getApiUnixSocketPath(),
    retry: { count: 2, wait: 1000 },
    checkStatus: isSystemServiceRunning,
    programPath: await getProgramPath(),
    ...({
      useWSL: isWSL(),
      useLIMA: isLIMA(),
    }),
    ...(opts || {}),
  };
  logger.debug("Client opts", clientOpts);
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
        const program = await getProgram("podman");
        const systemApiResult = await getApiDriver().get("/info");
        const running = await isSystemServiceRunning();
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
    running = await isSystemServiceRunning();
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

async function isSystemServiceRunning(driver) {
  let running = false;
  const apiDriver = driver || getApiDriver();
  try {
    const result = await apiDriver.get("/_ping");
    running = result?.data === "OK";
  } catch (error) {
    logger.error("Unable to get status", error.message);
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
  getApiUnixSocketPath,
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
  startSystemService,
  getSystemEnvironment,
  isSystemServiceRunning,
  resetSystem,
  getWSLDistributions
};
