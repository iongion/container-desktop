const os = require("os");
const fs = require("fs");
const path = require("path");
// vendors
const axios = require("axios");
const UrlPattern = require("url-pattern");
// project
const { axiosConfigToCURL } = require("@podman-desktop-companion/utils");
const { createLogger, getLevel, setLevel } = require("@podman-desktop-companion/logger");
const userSettings = require("@podman-desktop-companion/user-settings");
// local
const { exec, exec_launcher, withClient } = require("@podman-desktop-companion/executor");
const { launchTerminal } = require("@podman-desktop-companion/terminal");
const logger = createLogger("container-client");

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

function getConfigurationPath() {
  return userSettings.getPath();
}

function getEngine() {
  return userSettings.get("engine", detectEngine());
}

function setEngine(value) {
  const engine = value || getEngine();
  userSettings.set("engine", engine);
  return engine;
}

function getAutoStartApi() {
  return userSettings.get("autoStartApi", false);
}

function getCommunication() {
  return userSettings.get("communication", "api");
}

async function getUserConfiguration() {
  const options = {
    engine: getEngine(),
    program: await getProgram(getProgramName()),
    autoStartApi: getAutoStartApi(),
    communication: getCommunication(),
    path: getConfigurationPath(),
    logging: {
      level: getLevel()
    }
  };
  return options;
}

async function setUserConfiguration(options) {
  Object.keys(options).forEach((key) => {
    if (key === "logging.level") {
      setLevel(options[key]);
    } else {
      userSettings.set(key, options[key]);
    }
  });
  return await getUserConfiguration();
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
  let programPath = userSettings.get(programKey);
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
  userSettings.set(programKey, programPath);
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
  const output = await execProgram(["system", "info", "--format", "json"]);
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

async function pruneSystem(all, filter, force, volumes) {
  let result;
  const args = ["system", "prune"];
  if (all) {
    args.push("-all");
  }
  if (filter) {
    args.push(...Object.keys(filter).map((key) => `label=${key}=${filter[key]}`));
  }
  if (force) {
    args.push("--force");
  }
  if (volumes) {
    args.push("--volumes");
  }
  const output = await execProgram(args);
  if (!output.success) {
    logger.error("Unable to prune system", output);
  }
  // TODO: Implement result as the REST api
  return {
    ContainerPruneReports: null,
    ImagePruneReports: null,
    PodPruneReport: null,
    ReclaimedSpace: -1,
    VolumePruneReports: null
  };
}

function getCurrentMachine() {
  // TODO: Choose machine
  let machine;
  machine = "podman-machine-default";
  return machine;
}

function getCurrentMachineNamedPipeApiSocketPath() {
  let name = getCurrentMachine();
  // if (os.type() === "Windows_NT") {
  //   name = "docker_engine";
  // }
  return `//./pipe/${name}`;
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
    baseURL: "http://d/v3.0.0/libpod",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    }
  };
  logger.debug("API configuration", config);
  return config;
}

function getApiDriver(cfg) {
  const config = cfg || getApiConfig();
  config.adapter = require("axios/lib/adapters/http");
  const driver = axios.create(config);
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

function getCliDriver() {
  const driver = {
    request: async (options) => {
      const requestsMap = {
        "/images/json": {
          GET: async (input) => {
            const { method, url, headers, params, body } = input;
            const result = await getImages();
            return {
              data: result,
              headers: [],
              status: 200,
              statusText: "OK"
            };
          }
        },
        "/images/:id/json": {
          GET: async (input) => {
            const { method, url, headers, params, body } = input;
            const result = await getImage(params.id);
            return result
              ? {
                  data: result,
                  headers: [],
                  status: 200,
                  statusText: "OK"
                }
              : {
                  data: result,
                  headers: [],
                  status: 404,
                  statusText: "NotFound"
                };
          }
        },
        "/images/:id/history": {
          GET: async (input) => {
            const { method, url, headers, params, body } = input;
            const result = await getImageHistory(params.id);
            return result
              ? {
                  data: result,
                  headers: [],
                  status: 200,
                  statusText: "OK"
                }
              : {
                  data: result,
                  headers: [],
                  status: 404,
                  statusText: "NotFound"
                };
          }
        },
        "/containers/json": {
          GET: async (input) => {
            const { method, url, headers, params, body } = input;
            const result = await getContainers();
            return {
              data: result,
              headers: [],
              status: 200,
              statusText: "OK"
            };
          }
        },
        "/containers/:id/json": {
          GET: async (input) => {
            const { method, url, headers, params, body } = input;
            const result = await getContainer(params.id);
            return result
              ? {
                  data: result,
                  headers: [],
                  status: 200,
                  statusText: "OK"
                }
              : {
                  data: result,
                  headers: [],
                  status: 404,
                  statusText: "NotFound"
                };
          }
        },
        "/containers/:id/logs": {
          GET: async (input) => {
            const { method, url, headers, params, body } = input;
            const result = await getContainerLogs(params.id);
            return {
              data: result || "",
              headers: [],
              status: 200,
              statusText: "OK"
            };
          }
        },
        "/containers/:id/stats": {
          GET: async (input) => {
            const { method, url, headers, params, body } = input;
            const result = await getContainerStats(params.id);
            return {
              data: result || [],
              headers: [],
              status: 200,
              statusText: "OK"
            };
          }
        },
        "/containers/:id/:action": {
          POST: async (input) => {
            const { method, url, headers, params, body } = input;
            const result = await containerAction(params.id, params.action);
            return {
              data: result || [],
              headers: [],
              status: 200,
              statusText: "OK"
            };
          }
        },
        "/volumes/json": {
          GET: async (input) => {
            const { method, url, headers, params, body } = input;
            const result = await getVolumes();
            return {
              data: result,
              headers: [],
              status: 200,
              statusText: "OK"
            };
          }
        },
        "/secrets/json": {
          GET: async (input) => {
            const { method, url, headers, params, body } = input;
            const result = await getSecrets();
            return {
              data: result,
              headers: [],
              status: 200,
              statusText: "OK"
            };
          }
        },
        "/secrets/:id/json": {
          GET: async (input) => {
            const { method, url, headers, params, body } = input;
            const result = await getSecret(params.id);
            return result
              ? {
                  data: result,
                  headers: [],
                  status: 200,
                  statusText: "OK"
                }
              : {
                  data: result,
                  headers: [],
                  status: 404,
                  statusText: "NotFound"
                };
          }
        },
        "/system/info": {
          GET: async (input) => {
            const { method, url, headers, params, body } = input;
            const result = await getSystemInfo();
            return {
              data: result,
              headers: [],
              status: 200,
              statusText: "OK"
            };
          }
        },
        "/system/prune": {
          GET: async (input) => {
            const { method, url, headers, params, body } = input;
            const result = await pruneSystem();
            return {
              data: result,
              headers: [],
              status: 200,
              statusText: "OK"
            };
          }
        }
      };
      const routes = Object.keys(requestsMap).map((pattern) => ({
        pattern,
        matcher: new UrlPattern(pattern)
      }));
      // Find first match
      const route = routes.find((it) => it.matcher.match(options.url));
      if (route) {
        const match = route.matcher.match(options.url);
        const requestMethod = (options.method || "get").toUpperCase();
        const requestHandler = requestsMap[route.pattern][requestMethod];
        if (requestHandler) {
          return await requestHandler({
            ...options,
            params: match,
            query: options.params,
            route: route.pattern
          });
        } else {
          logger.warn("Request does not have a CLI mapping for this method - falling back to Api", options);
          return getApiDriver().request(options);
        }
      } else {
        logger.warn("Request does not have a CLI mapping for this pattern - falling back to Api", options);
        return getApiDriver().request(options);
      }
    }
  };
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

async function getContainer(id) {
  let items = [];
  const output = await execProgram(["container", "list", "--filter", `id=${id}`, "--format", "json"]);
  if (!output.success) {
    logger.error("Unable to get podman container", output);
    return items;
  }
  try {
    items = JSON.parse(output.stdout);
  } catch (error) {
    logger.error("Unable to decode podman container", error);
  }
  return items[0];
}

async function getContainerLogs(id) {
  let items = [];
  const output = await execProgram(["container", "logs", id]);
  if (!output.success) {
    logger.error("Unable to get podman container logs", output);
    return items;
  }
  try {
    items = output.stdout;
  } catch (error) {
    logger.error("Unable to decode podman container logs", error);
  }
  return items;
}

async function getContainerStats(id) {
  let items = [];
  const output = await execProgram(["container", "stats", "--no-stream", "--no-reset", id, "--format", "json"]);
  if (!output.success) {
    logger.error("Unable to get podman container stats", output);
    return items;
  }
  try {
    items = JSON.parse(output.stdout);
  } catch (error) {
    logger.error("Unable to decode podman container stats", error);
  }
  return items[0] || { cpu_stats: {} };
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

async function getImage(id) {
  let items = [];
  const output = await execProgram(["image", "list", "--filter", `id=${id}`, "--format", "json"]);
  if (!output.success) {
    logger.error("Unable to get podman image", output);
    return items;
  }
  try {
    items = JSON.parse(output.stdout);
  } catch (error) {
    logger.error("Unable to decode podman image", error);
  }
  return items[0];
}

async function getImageHistory(id) {
  let items = [];
  const output = await execProgram(["image", "history", id, "--format", "json"]);
  if (!output.success) {
    logger.error("Unable to get podman image history", output);
    return items;
  }
  try {
    items = JSON.parse(output.stdout);
  } catch (error) {
    logger.error("Unable to decode podman image history", error);
  }
  return items;
}

async function getMachines() {
  let items = [];
  const format = "{{.Name}}|{{.VMType}}|{{.Running}}|{{.Created}}|{{.LastUp}}|{{.CPUs}}|{{.Memory}}|{{.DiskSize}}\\n";
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

async function containerAction(id, action) {
  const output = await execProgram(["podman", "container", action, id]);
  if (!output.success) {
    logger.error("Unable to trigger container action", action, id);
  }
  return output.success;
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

async function getSecrets() {
  let items = [];
  const output = await execProgram(["secret", "ls", "--format", "{{json $}}"]);
  if (!output.success) {
    logger.error("Unable to get list of podman secrets", output);
    return items;
  }
  try {
    items = JSON.parse(output.stdout) || [];
    items = items.map((it) => {
      return {
        ID: it.ID,
        Spec: {
          Driver: {
            Name: it.Driver,
            Options: {
              path: undefined
            }
          },
          Name: it.Name
        },
        // TODO: Parse from now
        CreatedAt: it.CreatedAt,
        UpdatedAt: it.UpdatedAt
      };
    });
  } catch (error) {
    logger.error("Unable to decode list of podman secrets", error, output);
  }
  return items;
}

async function getSecret(id) {
  let item;
  const output = await execProgram(["secret", "ls", "--filter", `ID=${id}`, "--format", "{{json .}}"]);
  if (!output.success) {
    logger.error("Unable to get podman secret", output);
    return item;
  }
  try {
    const it = JSON.parse(output.stdout) || {};
    item = {
      ID: it.ID,
      Spec: {
        Driver: {
          Name: it.Driver,
          Options: {
            path: undefined
          }
        },
        Name: it.Name
      },
      // TODO: Parse from now
      CreatedAt: it.CreatedAt,
      UpdatedAt: it.UpdatedAt
    };
  } catch (error) {
    logger.error("Unable to decode list of podman secrets", error, output);
  }
  return item;
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
      programName = path.basename(programPath, path.extname(programPath));
      programTitle = parts[0] || programTitle;
    }
  }
  const program = {
    name: programName,
    path: programPath,
    currentVersion: programVersion,
    title: programTitle,
    homepage: `https://${programName}.io`
  };
  logger.debug("Detected program", program);
  return program;
}

async function getProgram(name) {
  switch (name) {
    case "podman":
      return getPodmanProgram();
    default:
      throw new Error(`Program ${program} not recognized`);
  }
}

// Container engine specific
async function startApi(opts) {
  const engine = getEngine();
  switch (engine) {
    case "native":
      return startNativeApi(opts);
    case "virtualized":
      return startVirtualizedApi(opts);
    default:
      throw new Error(`Engine ${engine} is not supported`);
  }
}

async function getApi() {
  const systemApiResult = await getApiDriver().get("/info");
  const running = await isApiRunning();
  const platform = os.type();
  const api = {
    platform,
    system: systemApiResult.data,
    running,
    connectionString: getApiSocketPath()
  };
  return api;
}

async function startVirtualizedApi(opts) {
  const machine = getCurrentMachine();
  logger.debug("Starting virtualized engine with machine", machine);
  const success = await startMachine(machine);
  if (success) {
    logger.debug("API virtualized engine started with machine", machine);
    return getApi();
  }
  logging.error("API virtualized engine startup failure with machine", machine);
  throw new ResultError("Unable to start machine", machine);
}

async function startNativeApi(opts) {
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
        resolve(getApi());
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
  let userConfiguration = {};
  try {
    userConfiguration = await getUserConfiguration();
  } catch (error) {
    logger.error("Unable to obtain user configuration info", error);
  }
  const platform = os.type();
  return {
    platform,
    connections,
    running,
    system,
    // User configuration
    userConfiguration
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

async function createApiRequest(options) {
  let result;
  const adapter = getCommunication();
  switch (adapter) {
    case "api":
      result = await getApiDriver().request(options);
      break;
    case "cli":
      result = await getCliDriver().request(options);
      break;
    default:
      throw new Error(`No such communication possible "${adapter}"`);
  }
  return result;
}

module.exports = {
  ResultError,
  createApiRequest,
  getConfigurationPath,
  getEngine,
  setEngine,
  getUserConfiguration,
  setUserConfiguration,
  getProgramPath,
  setProgramPath,
  getGithubRepoTags,
  getSystemConnections,
  getSystemInfo,
  pruneSystem,
  getApiSocketPath,
  getApiConfig,
  getApiDriver,
  getContainers,
  getContainer,
  getContainerLogs,
  getContainerStats,
  getImages,
  getImage,
  getMachines,
  createMachine,
  connectToContainer,
  connectToMachine,
  startMachine,
  stopMachine,
  restartMachine,
  removeMachine,
  containerAction,
  getVolumes,
  getSecrets,
  getSecret,
  getProgram,
  startApi,
  startNativeApi,
  startVirtualizedApi,
  getSystemEnvironment,
  isApiRunning,
  resetSystem
};
