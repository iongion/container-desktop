import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";
import httpAdapter from "axios/unsafe/adapters/http.js";
import { EventEmitter } from "eventemitter3";
import {
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
  spawn,
  spawnSync,
} from "node:child_process";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import portfinder from "portfinder";

import { getApiConfig } from "@/container-client/Api.clients";
import { type ISSHClient, SSHClient, type SSHClientConnection } from "@/container-client/services";
import {
  type ApiDriverConfig,
  type CommandExecutionResult,
  type Connection,
  ContainerEngine,
  ContainerEngineHost,
  type EngineConnectorSettings,
  OperatingSystem,
  type ServiceOpts,
  type Wrapper,
} from "@/env/Types";
import { createLogger } from "@/logger";
import { getWindowsPipePath } from "@/platform";
import { axiosConfigToCURL, deepMerge } from "@/utils";
import { v4 } from "uuid";
import { Platform } from "./node";

const logger = createLogger("shared");
const SSH_TUNNELS_CACHE: { [key: string]: string } = {};
const RELAY_SERVERS_CACHE: { [key: string]: WSLRelayServer } = {};
const DEFAULT_RETRIES_COUNT = 10;

const PROGRAM_SOCAT_RELAY = "container-desktop-wsl-relay-socat";
const PROGRAM_SSHD_RELAY = "container-desktop-ssh-relay-sshd";
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

async function getWSLDistributionUsername(distribution: string) {
  const wslUserOutput = await Command.Execute("wsl.exe", ["--distribution", distribution, "--exec", "whoami"]);
  const wslUser = wslUserOutput.stdout.toString().trim();
  return wslUser;
}

async function getWSLDistributionApplicationConfigDir(distribution: string) {
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

async function ensureRelayProgramExistsInWSLDistribution(distribution: string, dstWSLPath: string, srcWinPath: string) {
  const baseDirectory = await Path.dirname(dstWSLPath);
  const srcWSLPath = await convertWindowsPathToWSLPath(distribution, srcWinPath);
  await Command.Execute("wsl.exe", ["--distribution", distribution, "--exec", "mkdir", "-p", baseDirectory]);
  await Command.Execute("wsl.exe", ["--distribution", distribution, "--exec", "cp", "-u", srcWSLPath, dstWSLPath]);
  await Command.Execute("wsl.exe", ["--distribution", distribution, "--exec", "chmod", "+x", dstWSLPath]);
  return dstWSLPath;
}

export async function waitForApi({
  ping,
  pipeFullPath,
  tcpAddress,
  timeout,
  onStart,
  abort,
}: {
  ping: boolean | undefined;
  pipeFullPath: string;
  tcpAddress: string;
  timeout: number;
  abort: AbortController;
  onStart?: () => void;
}): Promise<{ started: boolean; socketPath: string; tcpAddress: string }> {
  let retries = DEFAULT_RETRIES_COUNT;
  let isChecking = false;
  const opts = { socketPath: pipeFullPath };
  const driver = createNodeJSApiDriver(opts);
  return await new Promise((resolve) => {
    const iid = setInterval(() => {
      if (isChecking) {
        return;
      }
      isChecking = true;
      retries -= 1;
      if (retries <= 0) {
        logger.warn("API check retries exhausted", { retries });
        clearInterval(iid);
        isChecking = false;
        resolve({ started: false, socketPath: pipeFullPath, tcpAddress });
      } else {
        if (ping && !abort.signal.aborted) {
          driver
            .get("/_ping", { signal: abort.signal })
            .then((response) => {
              if (response.data === "OK") {
                clearInterval(iid);
                isChecking = false;
                onStart?.();
                resolve({
                  started: true,
                  socketPath: pipeFullPath,
                  tcpAddress,
                });
              } else {
                isChecking = false;
              }
            })
            .catch((error) => {
              isChecking = false;
              logger.error("Ping response failed", { retries }, error);
            });
        } else {
          clearInterval(iid);
          isChecking = false;
          onStart?.();
          resolve({ started: true, socketPath: pipeFullPath, tcpAddress });
        }
      }
    }, timeout);
  });
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
  protected tcpAddress?: string;
  protected logLevel = "debug";

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
      ping,
    }: {
      pipePath: string;
      distribution: string;
      unixSocketPath: string;
      maxRespawnRetries: number;
      abort: AbortController;
      ping?: boolean;
    },
    // handlers
    onStart?: (server: WSLRelayServer, started: boolean) => void,
    onStop?: (server: WSLRelayServer, stopped: boolean) => void,
    onError?: (server: WSLRelayServer, error: any) => void,
  ): Promise<{
    started: boolean;
    socketPath?: string;
    tcpAddress?: string;
  }> => {
    let pipeFullPath = "";
    let tcpAddress = "";
    if (this.isListening) {
      logger.debug("Named pipe server already started");
      return Promise.resolve({
        started: true,
        socketPath: this.socketPath,
        tcpAddress: this.tcpAddress,
      });
    }
    distribution = distribution || "Ubuntu"; // Default to Ubuntu
    let wslAppHome = "";
    let bundleWindowsSocatRelayProgramPath = "";
    let bundleWindowsSSHRelayProgramPath = "";
    let bundleWindowsSSHServerRelayProgramPath = "";
    // Runtime wsl program paths
    let wslSocatRelayProgramPath = "";
    let wslSSHServerRelayProgramPath = "";
    let args: string[] = [];
    const relayMethod: string = import.meta.env.FEATURE_WSL_RELAY_METHOD;
    try {
      wslAppHome = await getWSLDistributionApplicationDataDir(distribution);
      // Bundle Windows paths
      bundleWindowsSSHRelayProgramPath = await Path.join(process.env.APP_PATH || "", "bin", PROGRAM_SSH_RELAY); // Windows binary
      bundleWindowsSocatRelayProgramPath = await Path.join(process.env.APP_PATH || "", "bin", PROGRAM_SOCAT_RELAY); // Linux binary
      bundleWindowsSSHServerRelayProgramPath = await Path.join(process.env.APP_PATH || "", "bin", PROGRAM_SSHD_RELAY); // Linux binary
      // Runtime WSL paths
      wslSocatRelayProgramPath = `${wslAppHome}/bin/${PROGRAM_SOCAT_RELAY}`;
      wslSSHServerRelayProgramPath = `${wslAppHome}/bin/${PROGRAM_SSHD_RELAY}`;
      maxRespawnRetries = maxRespawnRetries || 5;
      switch (relayMethod) {
        case "sshd":
          {
            await ensureRelayProgramExistsInWSLDistribution(
              distribution,
              wslSSHServerRelayProgramPath,
              bundleWindowsSSHServerRelayProgramPath,
            );
            pipeFullPath = pipePath;
            this.socketPath = pipeFullPath;
            this.tcpAddress = undefined;
          }
          break;
        case "socat":
          {
            await ensureRelayProgramExistsInWSLDistribution(
              distribution,
              wslSocatRelayProgramPath,
              bundleWindowsSocatRelayProgramPath,
            );
            pipeFullPath = pipePath;
            args = [
              // relay
              "--distribution",
              distribution,
              "--exec",
              wslSocatRelayProgramPath,
              "-v",
              "-d",
              "-d",
              "-d",
              `UNIX-CONNECT:${unixSocketPath},retry,forever`,
              "STDIO",
            ];
            this.socketPath = pipeFullPath;
            this.tcpAddress = undefined;
          }
          break;
        case "socat-tcp":
          {
            await ensureRelayProgramExistsInWSLDistribution(
              distribution,
              wslSocatRelayProgramPath,
              bundleWindowsSocatRelayProgramPath,
            );
            const host = "127.0.0.1";
            const port = await getFreeTCPPort();
            tcpAddress = `http://${host}:${port}`;
            args = [
              // relay
              "--distribution",
              distribution,
              "--exec",
              wslSocatRelayProgramPath,
              "-v",
              "-d",
              "-d",
              "-d",
              `TCP4-LISTEN:${port},reuseaddr,fork,bind=127.0.0.1`,
              `UNIX-CONNECT:${unixSocketPath},retry,forever`,
            ];
            this.socketPath = undefined;
            this.tcpAddress = tcpAddress;
          }
          break;
        default:
          break;
      }
    } catch (error: any) {
      logger.error("Error getting WSL relay program path", error.message);
      onError?.(this, error);
      return Promise.resolve({
        started: false,
        socketPath: pipeFullPath,
        tcpAddress,
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
    // Start the SSH relay process
    if (relayMethod === "sshd") {
      this.isListening = true;
      const relay_guid = v4();
      const windowsIdentityPath = await Path.join(await Platform.getUserDataPath(), "id_rsa");
      let connectionString = "";
      let sshServerAddress = "";
      try {
        const wslUser = await getWSLDistributionUsername(distribution);
        const wslRelayHost = "localhost";
        const wslRelayPort = await getFreeTCPPort();
        sshServerAddress = `${wslRelayHost}:${wslRelayPort}`;
        connectionString = `ssh://${wslUser}@${sshServerAddress}${unixSocketPath}`;
        // Spawn a windows named pipe to ssh tunnel relay process
        const relayNamedPipeSSHTunnelServerProcess = await spawnRelayProcess(
          bundleWindowsSSHRelayProgramPath,
          [
            // SSHD arguments
            "--named-pipe",
            `npipe://${pipePath.replaceAll("\\", "/")}`,
            "--ssh-connection",
            connectionString,
            "--ssh-timeout",
            "15",
            "--identity-path",
            windowsIdentityPath,
            // Relay arguments
            "--distribution",
            distribution,
            "--relay-program-path",
            wslSSHServerRelayProgramPath,
            "--watch-process-termination",
            "--generate-key-pair",
            "--host",
            wslRelayHost,
            "--port",
            `${wslRelayPort}`,
          ],
          {
            onClose: (_, code) => {
              this.isStarted = false;
              this.isListening = false;
              logger.debug(relay_guid, "Relay process closed", code);
              onStop?.(this, true);
            },
          },
        );
        this.relayProcesses[relay_guid] = relayNamedPipeSSHTunnelServerProcess;
      } catch (error: any) {
        this.isStarted = false;
        this.isListening = false;
        logger.error(relay_guid, "Error starting relay process", error);
        onError?.(this, error);
        return Promise.resolve({
          started: false,
          socketPath: pipeFullPath,
          tcpAddress: "",
        });
      }
      this.isStarted = true;
      this.isListening = true;
      return await waitForApi({
        ping,
        pipeFullPath,
        tcpAddress,
        onStart: () => {
          onStart?.(this, true);
        },
        timeout: 3000,
        abort,
      });
    }
    // Start the TCP relay process
    if (relayMethod === "socat-tcp") {
      this.isListening = true;
      const guid = v4();
      try {
        const relayProcess = await spawnRelayProcess("wsl.exe", args, {
          onClose: (_, code) => {
            this.isStarted = false;
            this.isListening = false;
            logger.debug(guid, "Relay process closed", code);
            onStop?.(this, true);
          },
        });
        this.relayProcesses[guid] = relayProcess;
        this.isStarted = true;
        this.isListening = true;
        return await waitForApi({
          ping,
          pipeFullPath,
          tcpAddress,
          timeout: 250,
          onStart: () => {
            onStart?.(this, true);
          },
          abort,
        });
      } catch (error: any) {
        this.isStarted = false;
        this.isListening = false;
        logger.error(guid, "Error starting relay process", error);
        onError?.(this, error);
        return Promise.resolve({
          started: false,
          socketPath: pipeFullPath,
          tcpAddress,
        });
      }
    }
    return new Promise((resolve, reject) => {
      logger.debug(
        `Creating named pipe server listening on ${pipeFullPath}, relaying to Unix socket ${unixSocketPath} in WSL distribution ${distribution}`,
      );
      // Handle client connections
      const server = net.createServer(async (clientSocket) => {
        let writeable = true;
        const guid = v4();
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
          resolve({ started: false, socketPath: pipeFullPath, tcpAddress });
        }
      });
      server.on("close", () => {
        logger.debug("Named pipe server closed");
        this.isStarted = false;
        this.isListening = false;
        onStop?.(this, true);
        if (!serverResolved) {
          serverResolved = true;
          resolve({ started: false, socketPath: pipeFullPath, tcpAddress });
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
          resolve({ started: true, socketPath: pipeFullPath, tcpAddress });
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

// locals
export async function getFreeTCPPort() {
  const minPort = 22022;
  try {
    const port = await portfinder.getPortPromise({ port: minPort, startPort: minPort, stopPort: 24044 });
    return port;
  } catch (error: any) {
    logger.error("Error getting free TCP port", error);
  }
  return minPort;
}

export function createNodeJSApiDriver(config: AxiosRequestConfig) {
  const httpAgent = new http.Agent({
    keepAlive: true,
    keepAliveMsecs: 10,
    timeout: config.timeout || 3000,
  });
  httpAgent.maxSockets = 1;
  const configuration = {
    ...config,
    adapter: httpAdapter,
    httpAgent: httpAgent,
    httpsAgent: httpAgent,
  };
  const driver = axios.create(configuration);
  logger.debug("Created NodeJS API driver", configuration);
  return driver;
}

export async function proxyRequestToWSLDistribution(
  connection: Connection,
  config: ApiDriverConfig,
  request: Partial<AxiosRequestConfig>,
) {
  return await new Promise<AxiosResponse<any, any> | undefined>((resolve, reject) => {
    //
    withWSLRelayServer(connection, { logLevel: connection.logLevel || "debug" }, async (server) => {
      // Make actual request to the temporary socket server created above
      let resolved = false;
      try {
        const abort = new AbortController();
        const pipePath = getWindowsPipePath(connection.id);
        const { started, socketPath, tcpAddress } = await server.start(
          {
            pipePath,
            distribution: connection.settings.controller?.scope || "Ubuntu",
            unixSocketPath: `${connection.settings.api.connection.relay}`.replace("unix://", ""),
            maxRespawnRetries: 5,
            ping: connection.engine === ContainerEngine.DOCKER,
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
            request.headers = deepMerge({}, config.headers || {}, request.headers || {});
            request.timeout = request.timeout || config.timeout || 1000;
            request.baseURL = tcpAddress || request.baseURL || "http://d";
            request.socketPath = socketPath;
            logger.debug(">> WSL Relay request", request, {
              socketPath,
              tcpAddress,
            });
            const driver = await createNodeJSApiDriver(request);
            const response = await driver.request(request);
            logger.debug("<< WSL Relay response", response);
            resolved = true;
            resolve(response);
          } catch (error: any) {
            logger.error("<< WSL Relay response", error);
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

export async function getSSHRelayLocalAddress(connection: Connection, socketPath?: string | null) {
  if (os.type() === OperatingSystem.Windows) {
    const namedPipe = getWindowsPipePath(connection.id);
    return namedPipe;
  }
  const userData = await Platform.getUserDataPath();
  const localAddress = await Path.join(userData, `container-desktop-ssh-relay-${connection.id}`);
  return localAddress;
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
    logger.debug("Reusing SSH tunnel", remoteAddress, SSH_TUNNELS_CACHE[remoteAddress]);
  } else {
    logger.debug("Creating SSH tunnel", remoteAddress);
    const sshConnection: ISSHClient = await context.getSSHConnection();
    if (!remoteAddress) {
      throw new Error("Remote address must be set");
    }
    // biome-ignore lint/style/useConst: <explanation>
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
    logger.debug("Proxying request to SSH tunnel", remoteAddress, "=>", localAddress, { connection, config, request });
    request.headers = deepMerge({}, config.headers || {}, request.headers || {});
    request.timeout = request.timeout || config.timeout || 5000;
    request.baseURL = request.baseURL || config.baseURL || "http://d";
    request.socketPath = localAddress;
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
  const spawnOpts = {
    encoding: "utf-8", // TODO: not working for spawn - find alternative
    cwd: opts?.cwd,
    env: opts?.env ? deepMerge({}, process.env, opts?.env || {}) : undefined,
    detached: opts?.detached,
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
        const processResolve = (from, data) => {
          if (resolved) {
            logger.error(command, "spawning already resolved", { from, data });
          } else {
            result.pid = child.pid as any;
            result.code = child.exitCode as any;
            result.stderr = result.stderr || "";
            result.success = child.exitCode === 0;
            result.command = command;
            resolved = true;
            logger.debug("[SC.A][<]", {
              pid: result.pid,
              code: result.code,
              success: result.success,
              command,
            });
            resolve(result);
          }
        };
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.on("exit", (code) => processResolve("exit", code));
        // child.on("close", (code) => processResolve("close", code));
        child.on("error", (error) => {
          logger.error(command, "spawning error", error.message);
          (result as any).error = error;
          processResolve("error", error);
        });
        child.stdout.on("data", (data) => {
          result.stdout += `${data}`;
        });
        child.stderr.on("data", (data) => {
          logger.warn(command, data);
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
    em.emit("ready", wrap_process(proc, child));
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
    let privateKeyPath = await Path.join(homeDir, ".ssh/id_rsa");
    if (host.IdentityFile) {
      privateKeyPath = host.IdentityFile;
      if (privateKeyPath.startsWith("~")) {
        privateKeyPath = privateKeyPath.replace("~", homeDir);
      }
      if (privateKeyPath.includes("$HOME")) {
        privateKeyPath = privateKeyPath.replace("$HOME", homeDir);
      }
    }
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
        logger.error("SSH connection error", error.message);
        reject(new Error("SSH connection error"));
      });
      const credentials = {
        host: host.HostName,
        port: host.Port || 22,
        username: host.User,
        privateKeyPath: privateKeyPath,
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
    switch (connection.host) {
      case ContainerEngineHost.PODMAN_NATIVE:
      case ContainerEngineHost.DOCKER_NATIVE:
      case ContainerEngineHost.PODMAN_VIRTUALIZED_VENDOR:
      case ContainerEngineHost.DOCKER_VIRTUALIZED_VENDOR:
      case ContainerEngineHost.PODMAN_VIRTUALIZED_LIMA:
      case ContainerEngineHost.DOCKER_VIRTUALIZED_LIMA:
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
            logger.warn("Error converting axios config to CURL", error);
          }
          logger.debug("Proxying request to host", {
            connection,
            config,
            request,
            curl,
          });
          const driver = await createNodeJSApiDriver(config);
          response = await driver.request(request);
          logger.debug("Proxy response", {
            data: response?.data,
            status: response?.status,
            statusText: response?.statusText,
          });
        }
        break;
      case ContainerEngineHost.PODMAN_VIRTUALIZED_WSL:
      case ContainerEngineHost.DOCKER_VIRTUALIZED_WSL:
        {
          const config = await getApiConfig(
            connection.settings.api,
            connection.settings.controller?.scope,
            connection.host,
          );
          config.socketPath = connection.settings.api.connection.relay;
          logger.debug("Proxying request to WSL distribution", {
            connection,
            config,
            request,
          });
          response = await proxyRequestToWSLDistribution(connection, config, request);
        }
        break;
      case ContainerEngineHost.PODMAN_REMOTE:
      case ContainerEngineHost.DOCKER_REMOTE:
        {
          const config = await getApiConfig(
            connection.settings.api,
            connection.settings.controller?.scope,
            connection.host,
          );
          config.socketPath = connection.settings.api.connection.uri;
          logger.debug("Proxying request to SSH connection", {
            connection,
            config,
          });
          response = await proxyRequestToSSHConnection(connection, config, request, context);
        }
        break;
      default:
        logger.error("Unsupported host", connection.host);
        break;
    }
    return response;
  },
};
