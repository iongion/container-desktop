import {
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
  spawn,
  spawnSync,
} from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";
import httpAdapter from "axios/unsafe/adapters/http.js";
import { EventEmitter } from "eventemitter3";
import { getApiConfig } from "@/container-client/Api.clients";
import { type ISSHClient, SSHClient, type SSHClientConnection } from "@/container-client/services";
import {
  type ApiDriverConfig,
  type CommandExecutionResult,
  type Connection,
  ContainerEngineHost,
  type EngineConnectorSettings,
  OperatingSystem,
  type ServiceOpts,
  type Wrapper,
} from "@/env/Types";
import { createLogger } from "@/logger";
import { axiosConfigToCURL, deepMerge, expandHome, isEmpty } from "@/utils";
import { Platform } from "./node";

const logger = createLogger("shared");
const SSH_TUNNELS_CACHE: { [key: string]: string } = {};
const RELAY_SERVERS_CACHE: { [key: string]: WSLRelayServer } = {};
const DEFAULT_RETRIES_COUNT = 10;
const DIRECT_API_HOSTS = new Set<ContainerEngineHost>([
  ContainerEngineHost.PODMAN_NATIVE,
  ContainerEngineHost.DOCKER_NATIVE,
  ContainerEngineHost.APPLE_NATIVE,
  ContainerEngineHost.PODMAN_VIRTUALIZED_VENDOR,
  ContainerEngineHost.DOCKER_VIRTUALIZED_VENDOR,
  ContainerEngineHost.PODMAN_VIRTUALIZED_LIMA,
  ContainerEngineHost.DOCKER_VIRTUALIZED_LIMA,
]);
const WSL_API_HOSTS = new Set<ContainerEngineHost>([
  ContainerEngineHost.PODMAN_VIRTUALIZED_WSL,
  ContainerEngineHost.DOCKER_VIRTUALIZED_WSL,
]);
const SSH_API_HOSTS = new Set<ContainerEngineHost>([
  ContainerEngineHost.PODMAN_REMOTE,
  ContainerEngineHost.DOCKER_REMOTE,
  ContainerEngineHost.APPLE_REMOTE,
]);

export type ProxyRequestRoute = "direct" | "wsl" | "ssh" | "unsupported";

export function getProxyRequestRoute(host: ContainerEngineHost): ProxyRequestRoute {
  if (DIRECT_API_HOSTS.has(host)) {
    return "direct";
  }
  if (WSL_API_HOSTS.has(host)) {
    return "wsl";
  }
  if (SSH_API_HOSTS.has(host)) {
    return "ssh";
  }
  return "unsupported";
}

function socketLabel(socketPath?: string | null): string | undefined {
  return socketPath ? path.basename(socketPath) || socketPath : undefined;
}

function connectionSummary(connection?: Partial<Connection>) {
  if (!connection) {
    return undefined;
  }
  return {
    id: connection.id,
    name: connection.name,
    engine: connection.engine,
    host: connection.host,
  };
}

function requestSummary(request: Partial<AxiosRequestConfig>) {
  return {
    method: `${request.method ?? "GET"}`.toUpperCase(),
    url: request.url,
    responseType: request.responseType,
    timeout: request.timeout,
    baseURL: request.baseURL,
    socket: socketLabel(request.socketPath),
    params: request.params,
  };
}

function responseSummary(response?: AxiosResponse<any, any>) {
  return {
    status: response?.status,
    statusText: response?.statusText,
  };
}

function errorSummary(error: any) {
  return {
    message: `${error?.message ?? error}`,
    code: error?.code,
    status: error?.response?.status,
    statusText: error?.response?.statusText,
  };
}

export function applyProxyRequestDefaults(
  request: Partial<AxiosRequestConfig>,
  config: ApiDriverConfig,
  fallback: { timeout: number; baseURL: string },
): Partial<AxiosRequestConfig> {
  request.headers = deepMerge({}, config.headers || {}, request.headers || {});
  request.timeout = request.timeout ?? config.timeout ?? fallback.timeout;
  request.baseURL = request.baseURL || config.baseURL || fallback.baseURL;
  return request;
}

/**
 * Test-only: clear the module-global connection caches between cases/targets. `StopConnectionServices`
 * only clears `RELAY_SERVERS_CACHE`; the SSH tunnel cache is otherwise cleared solely via a tunnel's
 * `onStopTunnel`, so live tests reusing a process would otherwise reuse a stale tunnel.
 */
export function __resetConnectionCaches() {
  for (const key of Object.keys(SSH_TUNNELS_CACHE)) {
    delete SSH_TUNNELS_CACHE[key];
  }
  for (const key of Object.keys(RELAY_SERVERS_CACHE)) {
    delete RELAY_SERVERS_CACHE[key];
  }
}

const PROGRAM_WSL_RELAY = "container-desktop-relay";
const PROGRAM_SSH_RELAY = "container-desktop-ssh-relay.exe";

// Servers
async function getWSLDistributionEnvironmentVariable(distribution: string, variable: string) {
  const wslCommandOutput = await Command.Execute("wsl.exe", [
    "--distribution",
    distribution,
    "--exec",
    "printenv",
    variable,
  ]);
  const wslUser = wslCommandOutput.stdout.toString().trim();
  return wslUser;
}

async function _getWSLDistributionApplicationConfigDir(distribution: string) {
  const appName = import.meta.env.PROJECT_NAME || "container-desktop";
  const XDG_CONFIG_HOME = await getWSLDistributionEnvironmentVariable(distribution, "XDG_CONFIG_HOME");
  if (XDG_CONFIG_HOME) {
    return `${XDG_CONFIG_HOME}/${appName}`;
  }
  const home = await getWSLDistributionEnvironmentVariable(distribution, "HOME");
  return `${home}/.config/${appName}`;
}

async function getWSLDistributionApplicationDataDir(distribution: string) {
  const appName = import.meta.env.PROJECT_NAME || "container-desktop";
  const XDG_DATA_HOME = await getWSLDistributionEnvironmentVariable(distribution, "XDG_DATA_HOME");
  if (XDG_DATA_HOME) {
    return `${XDG_DATA_HOME}/${appName}`;
  }
  const home = await getWSLDistributionEnvironmentVariable(distribution, "HOME");
  return `${home}/.local/share/${appName}`;
}

async function convertWindowsPathToWSLPath(distribution: string, windowsPath: string) {
  const command = await Command.Execute("wsl.exe", ["--distribution", distribution, "--exec", "wslpath", windowsPath]);
  const wslPath = command.stdout.trim();
  return wslPath;
}

// sha256OfFile returns the lowercase hex SHA-256 of a (Windows-side) file, or ""
// if it cannot be read - used to verify the relay bridge copied into the distro.
async function sha256OfFile(filePath: string): Promise<string> {
  try {
    return createHash("sha256")
      .update(await readFile(filePath))
      .digest("hex");
  } catch (error: any) {
    logger.warn("Unable to hash relay program", filePath, error?.message);
    return "";
  }
}

// wslFileHasSha256 checks a file inside the distribution against an expected hash
// using coreutils `sha256sum` (always present).
async function wslFileHasSha256(distribution: string, wslPath: string, expectedHash: string): Promise<boolean> {
  if (!expectedHash) {
    return false;
  }
  try {
    const out = await Command.Execute("wsl.exe", ["--distribution", distribution, "--exec", "sha256sum", wslPath]);
    const actual = `${out.stdout}`
      .trim()
      .toLowerCase()
      .match(/^[a-f0-9]{64}/)?.[0];
    return actual === expectedHash;
  } catch {
    return false;
  }
}

async function ensureRelayProgramExistsInWSLDistribution(distribution: string, dstWSLPath: string, srcWinPath: string) {
  const baseDirectory = await Path.dirname(dstWSLPath);
  const srcWSLPath = await convertWindowsPathToWSLPath(distribution, srcWinPath);
  const expectedHash = await sha256OfFile(srcWinPath);
  await Command.Execute("wsl.exe", ["--distribution", distribution, "--exec", "mkdir", "-p", baseDirectory]);
  // Copy only when the destination is missing or doesn't match the bundled binary
  // (self-healing across upgrades), then verify integrity before it is ever executed.
  if (!(await wslFileHasSha256(distribution, dstWSLPath, expectedHash))) {
    await Command.Execute("wsl.exe", ["--distribution", distribution, "--exec", "cp", srcWSLPath, dstWSLPath]);
    await Command.Execute("wsl.exe", ["--distribution", distribution, "--exec", "chmod", "+x", dstWSLPath]);
    if (expectedHash && !(await wslFileHasSha256(distribution, dstWSLPath, expectedHash))) {
      throw new Error(`Relay program integrity verification failed for ${dstWSLPath}`);
    }
  }
  return dstWSLPath;
}

export function killProcess(proc: ChildProcessWithoutNullStreams, signal?: NodeJS.Signals | number) {
  if (proc.stdin) {
    try {
      proc.stdin.end();
      proc.stdin.destroy();
    } catch (error: any) {
      logger.error(proc.pid, "Error closing stdin", error);
    }
  }
  if (proc.stdout) {
    try {
      proc.stdout.removeAllListeners();
      proc.stdout.destroy();
    } catch (error: any) {
      logger.error(proc.pid, "Error closing stdout", error);
    }
  }
  if (proc.stderr) {
    try {
      proc.stderr.removeAllListeners();
      proc.stderr.destroy();
    } catch (error: any) {
      logger.error(proc.pid, "Error closing stderr", error);
    }
  }
  try {
    logger.debug(proc.pid, "Killing process");
    proc.kill(signal);
  } catch (error: any) {
    logger.error(proc.pid, "Error killing process", error);
  }
  try {
    logger.debug(proc.pid, "Unref process");
    proc.unref();
  } catch (error: any) {
    logger.error(proc.pid, "Unref process failed", error);
  }
}

export class WSLRelayServer {
  protected server?: net.Server;
  protected isStarted = false;
  protected isListening = false;
  protected relayProcesses: { [key: string]: ChildProcessWithoutNullStreams } = {};

  protected socketPath?: string;
  protected logLevel = "warn";

  constructor(opts: { logLevel: string }) {
    this.isStarted = false;
    this.isListening = false;
    this.logLevel = opts.logLevel;
  }

  start = async (
    // opts
    {
      pipePath,
      distribution,
      unixSocketPath,
      maxRespawnRetries,
      abort,
    }: {
      pipePath: string;
      distribution: string;
      unixSocketPath: string;
      maxRespawnRetries: number;
      abort: AbortController;
    },
    // handlers
    onStart?: (server: WSLRelayServer, started: boolean) => void,
    onStop?: (server: WSLRelayServer, stopped: boolean) => void,
    onError?: (server: WSLRelayServer, error: any) => void,
  ): Promise<{
    started: boolean;
    socketPath?: string;
  }> => {
    let pipeFullPath = "";
    if (this.isListening) {
      logger.debug("Named pipe server already started");
      return Promise.resolve({
        started: true,
        socketPath: this.socketPath,
      });
    }
    distribution = distribution || "Ubuntu"; // Default to Ubuntu
    let wslAppHome = "";
    let bundleWindowsRelayProgramPath = "";
    let wslRelayProgramPath = "";
    let args: string[] = [];
    try {
      wslAppHome = await getWSLDistributionApplicationDataDir(distribution);
      bundleWindowsRelayProgramPath = await Path.join(process.env.APP_PATH || "", "bin", PROGRAM_WSL_RELAY);
      // Version-scope the in-distro path so an upgraded app never reuses a stale binary.
      const relayVersion = import.meta.env.PROJECT_VERSION || "current";
      wslRelayProgramPath = `${wslAppHome}/bin/${relayVersion}/${PROGRAM_WSL_RELAY}`;
      maxRespawnRetries = maxRespawnRetries || 5;
      // Ensure the relay bridge exists inside the distribution, then relay the engine's unix
      // socket over wsl.exe stdio (named pipe <-> stdio <-> unix socket; no listener, no SSH, no keys).
      await ensureRelayProgramExistsInWSLDistribution(distribution, wslRelayProgramPath, bundleWindowsRelayProgramPath);
      pipeFullPath = pipePath;
      args = [
        "--distribution",
        distribution,
        "--exec",
        wslRelayProgramPath,
        "--mode",
        "bridge",
        "--socket",
        unixSocketPath,
      ];
      this.socketPath = pipeFullPath;
    } catch (error: any) {
      logger.error("Error ensuring WSL relay program", error.message);
      onError?.(this, error);
      return Promise.resolve({
        started: false,
        socketPath: pipeFullPath,
      });
    }
    let serverResolved = false;
    const isRelayProcessUsable = (relayProcess?: ChildProcessWithoutNullStreams) => {
      return relayProcess !== undefined && !relayProcess.killed && relayProcess.exitCode === null;
    };
    const spawnRelayProcess = (
      relayProgram: string,
      args: string[],
      opts?: {
        onClose?: (relayProcess: ChildProcessWithoutNullStreams, code?: any) => void;
      },
    ): Promise<ChildProcessWithoutNullStreams> => {
      let resolved = false;
      return new Promise((resolve, reject) => {
        logger.warn(`[${relayProgram}] Starting relay process - ${relayProgram} ${args.join(" ")}`, this.logLevel);
        const relayProcess = spawn(relayProgram, args);
        if (this.logLevel === "debug") {
          relayProcess.stderr.setEncoding("utf8");
          relayProcess.stderr.on("data", (data) => {
            logger.warn(relayProcess.pid, `[${relayProgram}] Relay process stderr: ${data}`);
          });
        }
        logger.warn(relayProcess.pid, `[${relayProgram}] Started relay process`, {
          killed: relayProcess.killed,
          exitCode: relayProcess.exitCode,
        });
        relayProcess.on("close", (code) => {
          logger.warn(
            relayProcess.pid,
            `[${relayProgram}] Relay process close with code ${code}`,
            relayProcess.exitCode,
          );
          killProcess(relayProcess);
          abort.abort();
          opts?.onClose?.(relayProcess, code);
          if (!resolved) {
            resolved = true;
            reject(new Error(`Relay process exited with code ${code}`));
          }
        });
        relayProcess.on("spawn", () => {
          this.isStarted = isRelayProcessUsable(relayProcess);
          if (!resolved) {
            resolved = true;
            logger.warn(relayProcess.pid, `[${relayProgram}] Relay process spawned`);
            resolve(relayProcess);
          }
        });
      });
    };
    return new Promise((resolve) => {
      logger.debug(
        `Creating named pipe server listening on ${pipeFullPath}, relaying to Unix socket ${unixSocketPath} in WSL distribution ${distribution}`,
      );
      // Handle client connections
      const server = net.createServer(async (clientSocket) => {
        let writeable = true;
        const guid = crypto.randomUUID();
        logger.debug(guid, "Client connected to named pipe - allocating relay process");
        const relayProcess = await spawnRelayProcess("wsl.exe", args);
        this.relayProcesses[guid] = relayProcess;
        const onRelayData = (chunk) => {
          if (!writeable) {
            logger.debug(guid, "Client is not writeable, discarding relay output data", chunk.toString());
            return;
          }
          if (this.logLevel === "debug") {
            logger.debug(guid, `Received data from Unix socket, sending to client: ${chunk.length} bytes`);
          }
          clientSocket.write(chunk, (err) => {
            if (err) {
              logger.error(guid, `Error writing to client: ${err.message}`);
              writeable = false;
              clientSocket.end();
            }
          });
        };
        // Handle the end of the client connection
        clientSocket.on("end", () => {
          writeable = false;
          logger.debug(guid, "Client disconnected");
          relayProcess.stdout.off("data", onRelayData);
          killProcess(relayProcess);
          delete this.relayProcesses[guid];
        });
        clientSocket.on("close", () => {
          writeable = false;
          logger.debug(guid, "Client closed");
        });
        // Relay data from the client to the relay process (Unix socket)
        clientSocket.on("data", (chunk) => {
          if (this.logLevel === "trace") {
            logger.debug(guid, `Received data from client, sending to Unix socket: ${chunk.length} bytes`);
          }
          if (isRelayProcessUsable(relayProcess)) {
            relayProcess.stdin.write("");
            relayProcess.stdin.write(chunk, (err) => {
              if (err) {
                logger.error(guid, `Error writing to relay: ${err.message}`);
                writeable = false;
                clientSocket.end();
              }
            });
          } else {
            logger.error(guid, "Relay process is not running, closing client connection.");
            writeable = false;
            clientSocket.end();
          }
        });
        // Relay data from the relay process (Unix socket) to the client
        if (isRelayProcessUsable(relayProcess)) {
          relayProcess.stdout.on("data", onRelayData);
        } else {
          logger.error(guid, "Relay process is not running, closing client connection.");
          writeable = false;
          clientSocket.end();
        }
      });
      // Handle errors
      server.on("error", (err: any) => {
        logger.error(`Server error: ${err.message}`);
        this.isStarted = false;
        this.isListening = false;
        onError?.(this, err);
        if (!serverResolved) {
          serverResolved = true;
          resolve({ started: false, socketPath: pipeFullPath });
        }
      });
      server.on("close", () => {
        logger.debug("Named pipe server closed");
        this.isStarted = false;
        this.isListening = false;
        onStop?.(this, true);
        if (!serverResolved) {
          serverResolved = true;
          resolve({ started: false, socketPath: pipeFullPath });
        }
      });
      // Start the named pipe server
      server.listen(pipeFullPath, async () => {
        this.isStarted = true;
        this.isListening = true;
        logger.debug(`Named pipe server is listening on ${pipeFullPath}`);
        onStart?.(this, true);
        if (!serverResolved) {
          serverResolved = true;
          resolve({ started: true, socketPath: pipeFullPath });
        }
      });
      this.server = server;
    });
  };

  async stop() {
    this.isStarted = false;
    Object.keys(this.relayProcesses).forEach((key) => {
      const relayProcess = this.relayProcesses[key];
      if (relayProcess) {
        killProcess(relayProcess);
        delete this.relayProcesses[key];
      }
    });
    if (!this.server) {
      logger.debug("Named pipe server not started - stop skipped");
      return Promise.resolve(true);
    }
    // Stop the server
    return new Promise((resolve) => {
      try {
        logger.debug("Stopping named pipe server");
        this.server?.close(() => {
          logger.debug("Named pipe server stopped.");
          resolve(true);
        });
      } catch {
        logger.error("Error stopping named pipe server");
        resolve(true);
      }
    });
  }
}

export function withWSLRelayServer(
  connection: Connection,
  opts: { logLevel: string },
  callback: (server: WSLRelayServer) => void,
) {
  if (!RELAY_SERVERS_CACHE[connection.id]) {
    RELAY_SERVERS_CACHE[connection.id] = new WSLRelayServer(opts);
  }
  callback(RELAY_SERVERS_CACHE[connection.id]);
}

export interface WrapperOpts extends SpawnOptionsWithoutStdio {
  wrapper: Wrapper;
}

export function createNodeJSApiDriver(config: AxiosRequestConfig) {
  const timeout = config.timeout ?? 3000;
  const httpAgent = new http.Agent({
    keepAlive: true,
    keepAliveMsecs: 10,
    timeout,
  });
  httpAgent.maxSockets = 1;
  const configuration = {
    ...config,
    adapter: httpAdapter,
    httpAgent: httpAgent,
    httpsAgent: httpAgent,
    baseURL: config.baseURL || "http://d",
  };
  logger.debug("Creating NodeJS API driver", requestSummary(configuration));
  const driver = axios.create(configuration);
  return driver;
}

function createProxyStreamBridge(stream: any) {
  const emitter = new EventEmitter();
  let closed = false;
  const api = {
    on: (event: string, listener: (...args: any[]) => void) => {
      emitter.on(event, listener);
      return api;
    },
    off: (event: string, listener: (...args: any[]) => void) => {
      emitter.off(event, listener);
      return api;
    },
    removeListener: (event: string, listener: (...args: any[]) => void) => {
      emitter.removeListener(event, listener);
      return api;
    },
    destroy: () => {
      if (closed) {
        return;
      }
      closed = true;
      stream.destroy?.();
      emitter.removeAllListeners();
    },
    close: () => {
      api.destroy();
    },
  };
  stream.on?.("data", (chunk: any) => {
    emitter.emit("data", typeof chunk === "string" ? chunk : (chunk?.toString?.("utf8") ?? chunk));
  });
  stream.on?.("error", (error: any) => {
    emitter.emit("error", error);
  });
  stream.on?.("end", () => {
    emitter.emit("end");
  });
  stream.on?.("close", () => {
    emitter.emit("close");
  });
  return api;
}

export async function proxyRequestToWSLDistribution(
  connection: Connection,
  config: ApiDriverConfig,
  request: Partial<AxiosRequestConfig>,
) {
  return await new Promise<AxiosResponse<any, any> | undefined>((resolve, reject) => {
    //
    withWSLRelayServer(connection, { logLevel: connection.logLevel || "warn" }, async (server) => {
      // Make actual request to the temporary socket server created above
      let resolved = false;
      try {
        const abort = new AbortController();
        logger.debug("WSL relay starting", connectionSummary(connection));
        const pipePath = connection?.settings?.api?.connection?.uri || "";
        if (isEmpty(pipePath)) {
          logger.error("Named pipe path not set for current connection", connectionSummary(connection));
          throw new Error("Named pipe path not set for current connection");
        }
        const { started, socketPath } = await server.start(
          {
            pipePath,
            distribution: connection.settings.controller?.scope || "Ubuntu",
            unixSocketPath: `${connection.settings.api.connection.relay}`.replace("unix://", ""),
            maxRespawnRetries: 5,
            abort,
          },
          (_, started) => {
            logger.debug("WSL Relay server started", started);
          },
          (_, code) => {
            logger.debug("WSL Relay server stopped", code);
            abort.abort();
          },
          // On error
          (_, error) => {
            logger.error("WSL Relay server error", error);
            if (!resolved) {
              resolved = true;
              reject(error);
            }
          },
        );
        if (started) {
          try {
            applyProxyRequestDefaults(request, config, { timeout: 1000, baseURL: "http://d" });
            request.socketPath = socketPath;
            logger.debug("WSL relay request", {
              connection: connectionSummary(connection),
              request: requestSummary(request),
              socket: socketLabel(socketPath),
            });
            const driver = await createNodeJSApiDriver(request);
            const response = await driver.request(request);
            logger.debug("WSL relay response", responseSummary(response));
            resolved = true;
            resolve(response);
          } catch (error: any) {
            logger.error("WSL relay response failed", errorSummary(error));
            if (!resolved) {
              resolved = true;
              reject(error);
            }
          }
        } else {
          if (!resolved) {
            resolved = true;
            reject(new Error("WSL Relay server failed to start"));
          }
        }
      } catch (error: any) {
        logger.error("WSL Relay communication error", error);
        if (!resolved) {
          resolved = true;
          reject(error);
        }
      }
    });
  });
}

export async function proxyRequestToSSHConnection(
  connection: Connection,
  config: ApiDriverConfig,
  request: Partial<AxiosRequestConfig>,
  context?: any,
): Promise<AxiosResponse<any, any>> {
  const remoteAddress = connection.settings.api.connection.relay ?? "";
  const localAddress = connection.settings.api.connection.uri ?? "";
  if (SSH_TUNNELS_CACHE[remoteAddress]) {
    logger.debug("Reusing SSH tunnel", {
      remote: socketLabel(remoteAddress),
      local: socketLabel(SSH_TUNNELS_CACHE[remoteAddress]),
    });
  } else {
    logger.debug("Creating SSH tunnel", { remote: socketLabel(remoteAddress), local: socketLabel(localAddress) });
    const sshConnection: ISSHClient = await context.getSSHConnection();
    if (!remoteAddress) {
      // The remote engine socket could not be resolved — usually the engine isn't installed/running on
      // the remote host, or its CLI isn't on the non-interactive SSH PATH (so socket auto-detection failed).
      throw new Error(
        "Remote engine socket could not be determined — is the container engine installed and running on the remote host (and reachable on a non-interactive SSH PATH)?",
      );
    }
    let em: EventEmitter | undefined;
    em = await sshConnection.startTunnel({
      localAddress,
      remoteAddress,
      onStatusCheck: (status) => {
        if (em) {
          em.emit("status.check", status);
        }
      },
      onStopTunnel: () => {
        delete SSH_TUNNELS_CACHE[remoteAddress];
      },
    });
    if (em) {
      SSH_TUNNELS_CACHE[remoteAddress] = localAddress;
    }
  }
  if (SSH_TUNNELS_CACHE[remoteAddress]) {
    applyProxyRequestDefaults(request, config, { timeout: 5000, baseURL: "http://d" });
    request.socketPath = localAddress;
    logger.debug("Proxying request to SSH tunnel", {
      connection: connectionSummary(connection),
      remote: socketLabel(remoteAddress),
      local: socketLabel(localAddress),
      request: requestSummary(request),
    });
    const driver = createNodeJSApiDriver(request);
    const response = await driver.request(request);
    return response;
  }
  throw new Error("Tunneling failed - unable to start tunnel");
}

// Commander
export function applyWrapper(launcher: string, args: string[], opts?: WrapperOpts) {
  let commandLauncher = launcher;
  let commandArgs = args || [];
  if (opts?.wrapper) {
    commandLauncher = opts.wrapper.launcher;
    commandArgs = [...opts.wrapper.args, launcher, ...args];
  }
  // logger.debug("Applied wrapper", { launcher, args }, ">>>", { launcher: commandLauncher, args: commandArgs });
  return { commandLauncher, commandArgs };
}

export async function wrapSpawnAsync(launcher: string, launcherArgs: string[], launcherOpts?: Partial<WrapperOpts>) {
  let spawnLauncher = "";
  let spawnArgs: string[] = [];
  let spawnOpts: any;
  if (await Platform.isFlatpak()) {
    const hostLauncher = "flatpak-spawn";
    const hostArgs = [
      "--host",
      // remove flatpak container VFS prefix when executing
      launcher.replace("/var/run/host", ""),
      ...launcherArgs,
    ];
    spawnLauncher = hostLauncher;
    spawnArgs = hostArgs;
    spawnOpts = launcherOpts;
  } else {
    spawnLauncher = launcher;
    spawnArgs = launcherArgs;
    spawnOpts = launcherOpts;
  }
  const spawnLauncherOpts: WrapperOpts = {
    encoding: "utf-8",
    ...(spawnOpts || {}),
  };
  const command = [spawnLauncher, ...spawnArgs].join(" ");
  if (!spawnLauncher) {
    logger.error("[SC.A][>]", command, {
      spawnLauncher,
      spawnArgs,
      spawnLauncherOpts,
    });
    throw new Error("Launcher path must be set");
  }
  if (typeof spawnLauncher !== "string") {
    logger.error("[SC.A][>]", command, {
      spawnLauncher,
      spawnArgs,
      spawnLauncherOpts,
    });
    throw new Error("Launcher path has invalid type");
  }
  logger.debug("[SC.A][>][spawn]", {
    command: spawnLauncher,
    args: spawnArgs,
    opts: spawnLauncherOpts,
    commandLine: command,
  });
  const child = spawn(spawnLauncher, spawnArgs, spawnLauncherOpts);
  // store for tracing and debugging
  (child as any).command = command;
  return child;
}

export async function exec_launcher_async(launcher: string, launcherArgs: string[], opts?: WrapperOpts) {
  // const env = merge({}, { PODMAN_IGNORE_CGROUPSV1_WARNING: "true" }, opts?.env || {});
  const timeoutMs = typeof opts?.timeout === "number" && opts.timeout > 0 ? opts.timeout : undefined;
  const spawnOpts: any = {
    encoding: "utf-8", // TODO: not working for spawn - find alternative
    cwd: opts?.cwd,
    env: opts?.env ? deepMerge({}, process.env, opts?.env || {}) : undefined,
    detached: opts?.detached,
    stdio: opts?.detached ? "ignore" : undefined,
  };
  const { commandLauncher, commandArgs } = applyWrapper(launcher, launcherArgs, opts);
  return new Promise<CommandExecutionResult>((resolve, reject) => {
    let resolved = false;
    return wrapSpawnAsync(commandLauncher, commandArgs, spawnOpts)
      .then((child) => {
        //
        const result: CommandExecutionResult = {
          pid: undefined,
          code: undefined,
          success: false,
          stdout: "",
          stderr: "",
          command: "", // Decorated by child process
        };
        const command = (child as any).command;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const processResolve = (from, data) => {
          if (resolved) {
            return;
          }
          if (timeout) {
            clearTimeout(timeout);
          }
          result.pid = child.pid as any;
          result.code = from === "spawn" ? 0 : from === "timeout" ? null : (data as any);
          result.stderr = result.stderr || "";
          result.success = from === "spawn" ? true : from === "exit" && data === 0;
          result.command = command;
          resolved = true;
          logger.debug("[SC.A][<]", {
            pid: result.pid,
            code: result.code,
            success: result.success,
            command,
          });
          resolve(result);
        };
        if (timeoutMs) {
          timeout = setTimeout(() => {
            result.stderr = `${result.stderr || ""}${result.stderr ? "\n" : ""}Command timed out after ${timeoutMs}ms`;
            try {
              child.kill("SIGTERM");
            } catch (error: any) {
              logger.warn(command, "timeout kill failed", error?.message ?? error);
            }
            processResolve("timeout", null);
          }, timeoutMs);
          timeout.unref?.();
        }
        if (spawnOpts.detached) {
          child.on("spawn", () => {
            child.unref();
            processResolve("spawn", 0);
          });
        } else {
          child.on("exit", (code) => processResolve("exit", code));
        }
        child.stdout?.setEncoding("utf8");
        child.stderr?.setEncoding("utf8");
        // child.on("close", (code) => processResolve("close", code));
        child.on("error", (error) => {
          logger.error(command, "spawning error", error.message);
          (result as any).error = error;
          processResolve("error", error);
        });
        child.stdout?.on("data", (data) => {
          result.stdout += `${data}`;
        });
        child.stderr?.on("data", (data) => {
          result.stderr += `${data}`;
        });
      })
      .catch(reject);
  });
}

export async function exec_launcher(launcher, launcherArgs, opts?: WrapperOpts) {
  return await exec_launcher_async(launcher, launcherArgs, opts);
}

export function wrap_process(proc: any, child: any) {
  return {
    process: proc,
    child: {
      code: proc.code,
      success: proc.success,
      pid: proc.pid,
      kill: async (signal?: NodeJS.Signals | number) => {
        logger.debug("(OS) Killing child process started", proc.pid, {
          signal,
        });
        if (child) {
          killProcess(child, signal);
        } else {
          logger.warn("(OS) Killing child process skipped - child not started here", proc.pid);
        }
        logger.debug("(OS) Killing child process completed", proc.pid, {
          child,
        });
      },
      unref: () => {
        logger.debug("(OS) Unref child process started", proc.pid);
        try {
          if (child) {
            child.unref();
          } else {
            logger.warn("(OS) Unref child process skipped - child not started here", proc.pid);
          }
        } catch (error: any) {
          logger.error("(OS) Unref child process failed", error);
        }
        logger.debug("(OS) Unref child process completed", proc.pid);
      },
    },
  };
}

export async function exec_service(programPath: string, programArgs: string[], opts?: Partial<ServiceOpts>) {
  let isManagedExit = false;
  let child: ChildProcessWithoutNullStreams | undefined;
  const proc: CommandExecutionResult = {
    pid: null,
    code: null,
    success: false,
    stdout: "",
    stderr: "",
  };
  const em = new EventEmitter();
  // Check
  const running = opts?.checkStatus ? await opts.checkStatus({ pid: null, started: false }) : false;
  if (running) {
    logger.debug("Already running - reusing");
    proc.success = true;
    if (opts?.onSpawn) {
      opts?.onSpawn(wrap_process(proc, child));
    }
    setTimeout(() => em.emit("ready", wrap_process(proc, child)), 0);
  } else {
    // Handle
    const onProcessError = (child, error) => {
      logger.error("Child process error", error.code, error.message);
      em.emit("error", { type: "process.error", code: error.code });
    };
    const onProcessExit = (child, code) => {
      em.emit("exit", { code, managed: isManagedExit });
      isManagedExit = false;
    };
    const onProcessClose = (child, code) => {
      em.emit("close", { code });
    };
    const onProcessData = (child, from, data) => {
      if (from !== "stdout") {
        if (from === "stderr") {
          logger.warn("Child process data", child.pid, from, data);
        } else {
          logger.debug("Child process data", child.pid, from, data);
        }
      }
      em.emit("data", { from, data });
    };
    const waitForProcess = (child: ChildProcessWithoutNullStreams) => {
      let pending = false;
      const maxRetries = opts?.retry?.count || DEFAULT_RETRIES_COUNT;
      let retries = maxRetries;
      const wait = opts?.retry?.wait || 2000;
      const IID = setInterval(async () => {
        if (pending) {
          logger.debug("Waiting for result of last retry - skipping new retry");
          return;
        }
        logger.debug("Remaining", retries, "of", maxRetries);
        if (retries === 0) {
          clearInterval(IID);
          logger.error("Max retries reached");
          em.emit("error", { type: "domain.max-retries", code: undefined });
        } else {
          retries -= 1;
          pending = true;
          let running = false;
          try {
            logger.debug("Checking status", { pid: child.pid });
            em.emit("status.check", { retries, maxRetries });
            if (opts?.onStatusCheck) {
              opts?.onStatusCheck({ retries, maxRetries });
            }
            running = opts?.checkStatus ? await opts.checkStatus({ pid: child.pid, started: true }) : false;
          } catch (error: any) {
            logger.error("Checked status - failed", error.message);
          } finally {
            logger.debug("Checked status", { running });
          }
          pending = false;
          if (running) {
            clearInterval(IID);
            isManagedExit = true;
            proc.success = true;
            em.emit("ready", wrap_process(proc, child));
          } else {
            logger.error("Move to next retry", retries);
          }
        }
      }, wait);
    };
    // Starting spawn
    const launcherOpts = {
      encoding: "utf-8",
      cwd: opts?.cwd,
      env: opts?.env ? deepMerge({}, process.env, opts?.env || {}) : undefined,
    };
    child = await wrapSpawnAsync(programPath, programArgs, launcherOpts);
    proc.pid = child.pid!;
    proc.code = child.exitCode;
    if (opts?.onSpawn) {
      opts?.onSpawn(wrap_process(proc, child));
    }
    logger.debug("Child process spawned", child.pid, {
      programPath,
      programArgs,
      launcherOpts,
    });
    child.on("exit", (code) => onProcessExit(child, code));
    child.on("close", (code) => onProcessClose(child, code));
    child.on("error", (error) => onProcessError(child, error));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data) => onProcessData(child, "stdout", data.toString()));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (data) => onProcessData(child, "stderr", data.toString()));
    if (typeof child.pid === "undefined") {
      proc.success = false;
      logger.error("Child process spawn failure", proc);
    } else {
      proc.success = !child.killed;
      logger.debug("Child process spawn success", proc);
      waitForProcess(child);
    }
  }
  return {
    on: (event, listener, context?: any) => em.on(event, listener, context),
  };
}

export const Command: ICommand = {
  async CreateNodeJSApiDriver(config: AxiosRequestConfig<any>) {
    return createNodeJSApiDriver(config);
  },

  async Spawn(command: string, args?: readonly string[], options?: any) {
    return spawnSync(command, args, options);
  },

  async Kill(proc: ChildProcessWithoutNullStreams, signal?: NodeJS.Signals | number) {
    return killProcess(proc, signal);
  },

  async Execute(launcher: string, args: string[], opts?: WrapperOpts) {
    return await exec_launcher_async(launcher, args, opts);
  },

  async ExecuteAsBackgroundService(launcher: string, args: string[], opts?: Partial<ServiceOpts>) {
    return await exec_service(launcher, args, opts);
  },

  async StartSSHConnection(host: SSHHost, opts?: Partial<ServiceOpts>) {
    const homeDir = await Platform.getHomeDir();
    const privateKeyPath = host.IdentityFile ? expandHome(host.IdentityFile, homeDir) : "";
    host.IdentityFile = privateKeyPath;
    const isWindows = (os.type() as OperatingSystem) === OperatingSystem.Windows;
    const sshRelayProgramCLI = isWindows
      ? await Path.join(process.env.APP_PATH || "", "bin", PROGRAM_SSH_RELAY)
      : "ssh";
    return new Promise<ISSHClient>((resolve, reject) => {
      // function Client() {}
      const connection = new SSHClient({
        osType: os.type() as OperatingSystem,
        cli: isWindows ? "ssh.exe" : "ssh",
        relayCLI: sshRelayProgramCLI,
      });
      connection.on("connection.established", () => {
        logger.debug("Connection established", connection);
        // Wrap as object as it is passed from electron to renderer process - that one can't pass class instances
        resolve({
          isConnected: () => connection.isConnected(),
          connect: async (params: SSHClientConnection) => await connection.connect(params),
          execute: async (command: string[]) => await connection.execute(command),
          startTunnel: async (params: {
            localAddress: string;
            remoteAddress: string;
            onStatusCheck: (status: any) => void;
            onStopTunnel: () => void;
          }) =>
            await connection.startTunnel({
              ...params,
              onStatusCheck: (status) => {
                connection.emit("status.check", status);
                if (opts?.onStatusCheck) {
                  opts?.onStatusCheck(status);
                }
                if (params?.onStatusCheck) {
                  params?.onStatusCheck(status);
                }
              },
            }),
          stopTunnel: () => connection.stopTunnel(),
          on: (event, listener, context) => connection.on(event, listener, context),
          emit: (event, data) => connection.emit(event, data),
          close: () => connection.close(),
        } as ISSHClient);
      });
      connection.on("error", (error: any) => {
        // `error` is either a raw CommandExecutionResult (legacy) or { output, report } from the
        // preflight. Surface the first concrete failure reason instead of a generic message so the
        // caller/UI can explain why (#186), and attach the structured report for richer display.
        const report = error?.report;
        const reason =
          report?.steps?.find((step: any) => !step.skipped && !step.ok)?.details ||
          error?.message ||
          error?.output?.stderr ||
          error?.stderr ||
          "SSH connection failed";
        logger.error("SSH connection error", reason);
        const wrapped: any = new Error(reason);
        wrapped.report = report;
        reject(wrapped);
      });
      const credentials = {
        host: host.HostName || host.Host || host.Name,
        port: host.Port || 22,
        username: host.User || "",
        privateKeyPath,
        configHost: host.ConfigHost,
      };
      logger.debug("Connecting to SSH server using", credentials, "from host", host);
      connection.connect(credentials);
    });
  },

  async StopConnectionServices(connection_id: string, settings: EngineConnectorSettings): Promise<void> {
    if (RELAY_SERVERS_CACHE[connection_id]) {
      await RELAY_SERVERS_CACHE[connection_id].stop();
      delete RELAY_SERVERS_CACHE[connection_id];
    }
  },

  async ProxyRequest(request: Partial<AxiosRequestConfig>, connection: Connection, context?: any) {
    let response: AxiosResponse<any, any> | undefined;
    switch (getProxyRequestRoute(connection.host)) {
      case "direct":
        {
          const config = await getApiConfig(
            connection.settings.api,
            connection.settings.controller?.scope,
            connection.host,
          );
          let curl = "";
          try {
            const socketPath = connection?.settings?.api?.connection?.relay || config.socketPath;
            curl = axiosConfigToCURL({
              ...config,
              ...request,
              socketPath,
            }) as string;
          } catch (error: any) {
            logger.debug("Unable to build proxy CURL preview", {
              connection: connectionSummary(connection),
              error: errorSummary(error),
              request: requestSummary(request),
            });
          }
          logger.debug("Proxying request to host", {
            connection: connectionSummary(connection),
            config: {
              baseURL: config.baseURL,
              socket: socketLabel(config.socketPath),
              timeout: config.timeout,
            },
            request: requestSummary(request),
            curl,
          });
          const driver = await createNodeJSApiDriver(config);
          response = await driver.request(request);
          logger.debug("Proxy response", {
            request: requestSummary(request),
            response: responseSummary(response),
          });
        }
        break;
      case "wsl":
        {
          const config = await getApiConfig(
            connection.settings.api,
            connection.settings.controller?.scope,
            connection.host,
          );
          config.socketPath = connection.settings.api.connection.relay;
          logger.debug("Proxying request to WSL distribution", {
            connection: connectionSummary(connection),
            config: {
              baseURL: config.baseURL,
              socket: socketLabel(config.socketPath),
              timeout: config.timeout,
            },
            request: requestSummary(request),
          });
          response = await proxyRequestToWSLDistribution(connection, config, request);
        }
        break;
      case "ssh":
        {
          const config = await getApiConfig(
            connection.settings.api,
            connection.settings.controller?.scope,
            connection.host,
          );
          config.socketPath = connection.settings.api.connection.uri;
          logger.debug("Proxying request to SSH connection", {
            connection: connectionSummary(connection),
            config: {
              baseURL: config.baseURL,
              socket: socketLabel(config.socketPath),
              timeout: config.timeout,
            },
            request: requestSummary(request),
          });
          response = await proxyRequestToSSHConnection(connection, config, request, context);
        }
        break;
      default:
        logger.error("Unsupported host", connection.host);
        break;
    }
    if (request.responseType === "stream" && response?.data?.on) {
      response.data = createProxyStreamBridge(response.data);
    }
    return response;
  },
};
