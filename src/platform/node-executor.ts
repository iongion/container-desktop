import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import httpAdapter from "axios/unsafe/adapters/http.js";
import { EventEmitter } from "eventemitter3";
import { ChildProcess, ChildProcessWithoutNullStreams, spawn, SpawnOptionsWithoutStdio, spawnSync } from "node:child_process";
import http from "node:http";
import net from "node:net";
import os from "node:os";

import { getApiConfig } from "@/container-client/Api.clients";
import { ISSHClient, SSHClient, SSHClientConnection } from "@/container-client/services";
import { ApiDriverConfig, CommandExecutionResult, Connection, ContainerEngine, ContainerEngineHost, EngineConnectorSettings, OperatingSystem, Wrapper } from "@/env/Types";
import { createLogger } from "@/logger";
import { axiosConfigToCURL, deepMerge } from "@/utils";
import { v4 } from "uuid";
import { Platform } from "./node";

const logger = createLogger("shared");
const SSH_TUNNELS_CACHE: { [key: string]: string } = {};
const RELAY_SERVERS_CACHE: { [key: string]: WSLRelayServer } = {};
const DEFAULT_RETRIES_COUNT = 15;

// Servers
export async function exec_buffered(hostLauncher: string, commandLine: string[], onChunk?: (buffer: Buffer) => void) {
  return await new Promise<{ stdout: Buffer; stderr: Buffer; exitCode: number | null; command: string }>((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let resolved = false;
    logger.debug("Spawning WSL process", [hostLauncher, ...commandLine].join(" "));
    const child = spawn(hostLauncher, commandLine, {
      shell: false,
      windowsHide: true,
      stdio: ["inherit", "pipe", "pipe"]
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", function (data) {
      const chunk = Buffer.from(data);
      stdoutChunks.push(chunk);
      if (onChunk) {
        onChunk(chunk);
      }
    });
    child.stderr.on("data", function (data) {
      stderrChunks.push(Buffer.from(data));
    });
    child.on("exit", function (code) {
      if (!resolved) {
        resolved = true;
        logger.debug("Child process exited", code);
        try {
          if (child.stdin) {
            logger.debug("Ending child process stdin");
            (child.stdin as any).end();
          }
        } catch (error) {
          logger.error("child process stdin end error", error);
        }
        resolve({
          //
          stdout: Buffer.concat(stdoutChunks),
          stderr: Buffer.concat(stderrChunks),
          exitCode: child.exitCode,
          command: [hostLauncher, ...commandLine].join(" ")
        });
      }
    });
    child.on("error", function (error) {
      logger.error("child process error", error);
      if (!resolved) {
        resolved = true;
        reject(error);
      }
    });
  });
}

async function getWSLDistributionUser(distribution: string) {
  const wslUserOutput = await Command.Execute("wsl.exe", ["--distribution", distribution, "--exec", "whoami"]);
  const wslUser = wslUserOutput.stdout.toString().trim();
  return wslUser;
}

async function ensureRelayProgramExistsInWSLDistribution(wslPath: string, windowsPath: string, distribution: string) {
  const baseDirectory = await Path.dirname(wslPath);
  await Command.Execute("wsl.exe", ["--distribution", distribution, "--exec", "mkdir", "-p", baseDirectory]);
  await Command.Execute("wsl.exe", ["--distribution", distribution, "--exec", "cp", "-u", windowsPath, wslPath]);
}

export class WSLRelayServer {
  protected server?: net.Server;
  protected isStarted: boolean = false;
  protected isListening: boolean = false;
  protected relayProcesses: { [key: string]: ChildProcessWithoutNullStreams } = {};

  protected socketPath?: string;
  protected tcpAddress?: string;

  constructor() {
    this.isStarted = false;
    this.isListening = false;
  }

  start = async (
    // opts
    {
      pipeName,
      distribution,
      unixSocketPath,
      relayProgram,
      maxRespawnRetries,
      ping
    }: {
      pipeName: string;
      distribution: string;
      unixSocketPath: string;
      relayProgram: string;
      maxRespawnRetries: number;
      ping?: boolean;
    },
    // handlers
    onStart?: (server: WSLRelayServer, started: boolean) => void,
    onStop?: (server: WSLRelayServer, stopped: boolean) => void,
    onError?: (server: WSLRelayServer, error: any) => void
  ): Promise<{ started: boolean; socketPath?: string; tcpAddress?: string }> => {
    let pipeFullPath = "";
    let tcpAddress: string = "";
    if (this.isListening) {
      logger.debug("Named pipe server already started");
      return Promise.resolve({ started: true, socketPath: this.socketPath, tcpAddress: this.tcpAddress });
    }
    let windowsRelayProgramPath = "";
    let wslLinuxRelayProgramPath = "";
    let bundleLinuxRelayProgramPath = "";
    let args: string[] = [];
    const relayMethod: string = "socat-tcp";
    try {
      windowsRelayProgramPath = await Path.join(process.env.APP_PATH || "", "bin", `${relayProgram}.exe`);
      const wslUser = await getWSLDistributionUser(distribution);
      const safePathWSLUser = wslUser.replace(/ /g, "\\ ");
      const bundleWinUnixSocketRelayProgramPath = await Path.join(process.env.APP_PATH || "", "bin", relayProgram);
      const bundleWSLUnixSocketRelayProgramCommand = await Command.Execute("wsl.exe", ["--distribution", distribution, "--exec", "wslpath", bundleWinUnixSocketRelayProgramPath]);
      bundleLinuxRelayProgramPath = bundleWSLUnixSocketRelayProgramCommand.stdout.trim();
      wslLinuxRelayProgramPath = `/home/${safePathWSLUser}/.local/bin/${relayProgram}`;
      distribution = distribution || "Ubuntu"; // Default to Ubuntu
      relayProgram = relayProgram || "socat"; // Default to socat
      maxRespawnRetries = maxRespawnRetries || 5;
      switch (relayMethod) {
        case "socat":
          {
            await ensureRelayProgramExistsInWSLDistribution(wslLinuxRelayProgramPath, bundleLinuxRelayProgramPath, distribution);
            pipeFullPath = `\\\\.\\pipe\\${pipeName}`;
            args = [
              // relay
              "--distribution",
              distribution,
              "--exec",
              wslLinuxRelayProgramPath,
              `UNIX-CONNECT:${unixSocketPath},retry,forever`,
              "STDIO"
            ];
            this.socketPath = pipeFullPath;
            this.tcpAddress = undefined;
          }
          break;
        case "socat-tcp":
          {
            await ensureRelayProgramExistsInWSLDistribution(wslLinuxRelayProgramPath, bundleLinuxRelayProgramPath, distribution);
            const host = "127.0.0.1";
            const port = await getFreeTCPPort();
            tcpAddress = `http://${host}:${port}`;
            args = [
              // relay
              "--distribution",
              distribution,
              "--exec",
              wslLinuxRelayProgramPath,
              `TCP-LISTEN:${port},reuseaddr,fork,bind=127.0.0.1`,
              `UNIX-CONNECT:${unixSocketPath},retry,forever`
            ];
            this.socketPath = undefined;
            this.tcpAddress = tcpAddress;
          }
          break;
        case "winsocat":
          {
            pipeFullPath = `//./pipe/${pipeName}`;
            args = [
              //
              `NPIPE-LISTEN:${pipeName}`,
              `WSL:"${wslLinuxRelayProgramPath} STDIO UNIX-CONNECT:${unixSocketPath}",distribution=${distribution}`
            ];
            this.socketPath = pipeFullPath;
            this.tcpAddress = undefined;
          }
          break;
        default:
          break;
      }
    } catch (error: any) {
      logger.error("Error getting WSL relay program path", error.message);
      onError?.(this, error);
      return Promise.resolve({ started: false, socketPath: pipeFullPath, tcpAddress });
    }
    let serverResolved = false;
    const isRelayProcessUsable = (relayProcess?: ChildProcessWithoutNullStreams) => {
      return relayProcess !== undefined && !relayProcess.killed && relayProcess.exitCode === null;
    };
    const spawnRelayProcess = (opts?: { onClose?: (relayProcess: ChildProcessWithoutNullStreams, code?: any) => void }): Promise<ChildProcessWithoutNullStreams> => {
      let resolved = false;
      return new Promise((resolve, reject) => {
        const relayProgram = relayMethod === "winsocat" ? windowsRelayProgramPath : "wsl.exe";
        logger.warn(`Starting relay process: ${relayProgram} ${args.join(" ")}`);
        const relayProcess = spawn(relayProgram, args);
        relayProcess.stderr.setEncoding("utf8");
        relayProcess.stderr.on("data", (data) => {
          logger.error(`Relay process error: ${data}`);
        });
        logger.debug(`Started relay process with PID: ${relayProcess.pid}`, { killed: relayProcess.killed, exitCode: relayProcess.exitCode });
        relayProcess.on("close", (code) => {
          logger.debug(`Relay process close with code ${code}`, relayProcess.exitCode);
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
            logger.debug("Relay process spawned", relayProcess.pid);
            resolve(relayProcess);
          }
        });
      });
    };
    if (relayMethod === "winsocat" || relayMethod === "socat-tcp") {
      this.isListening = true;
      const guid = v4();
      try {
        const relayProcess = await spawnRelayProcess({
          onClose: (_, code) => {
            this.isStarted = false;
            this.isListening = false;
            logger.debug(guid, "Relay process closed", code);
            onStop?.(this, true);
          }
        });
        this.relayProcesses[guid] = relayProcess;
        this.isStarted = true;
        this.isListening = true;
        let retries = DEFAULT_RETRIES_COUNT;
        let isChecking = false;
        const opts = tcpAddress ? { baseURL: tcpAddress.startsWith("http") ? tcpAddress : `http://${tcpAddress}` } : { socketPath: pipeFullPath };
        const driver = createNodeJSApiDriver(opts);
        return await new Promise((resolve) => {
          const iid = setInterval(() => {
            if (isChecking) {
              return;
            }
            isChecking = true;
            retries -= 1;
            if (retries <= 0) {
              clearInterval(iid);
              isChecking = false;
              resolve({ started: false, socketPath: pipeFullPath, tcpAddress });
            } else {
              if (ping) {
                driver
                  .get("/_ping")
                  .then((response) => {
                    if (response.data === "OK") {
                      clearInterval(iid);
                      isChecking = false;
                      onStart?.(this, true);
                      resolve({ started: true, socketPath: pipeFullPath, tcpAddress });
                    } else {
                      isChecking = false;
                    }
                  })
                  .catch((error) => {
                    isChecking = false;
                    logger.warn("Ping response failed", { retries }, error);
                  });
              } else {
                clearInterval(iid);
                isChecking = false;
                onStart?.(this, true);
                resolve({ started: true, socketPath: pipeFullPath, tcpAddress });
              }
            }
          }, 250);
        });
      } catch (error: any) {
        this.isStarted = false;
        this.isListening = false;
        logger.error(guid, "Error starting relay process", error);
        onError?.(this, error);
        return Promise.resolve({ started: false, socketPath: pipeFullPath, tcpAddress });
      }
    }
    return new Promise((resolve, reject) => {
      logger.debug(`Creating named pipe server listening on ${pipeFullPath}, relaying to Unix socket ${unixSocketPath} in WSL distribution ${distribution}`);
      // Handle client connections
      const server = net.createServer(async (clientSocket) => {
        let writeable = true;
        const guid = v4();
        logger.debug(guid, "Client connected to named pipe - allocating relay process");
        const relayProcess = await spawnRelayProcess();
        this.relayProcesses[guid] = relayProcess;
        const onRelayData = (chunk) => {
          if (!writeable) {
            logger.debug(guid, "Client is not writeable, discarding relay output data", chunk.toString());
            return;
          }
          logger.debug(guid, `Received data from Unix socket, sending to client: ${chunk.length} bytes`);
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
          this.killProcess(relayProcess);
          delete this.relayProcesses[guid];
        });
        clientSocket.on("close", () => {
          writeable = false;
          logger.debug(guid, "Client closed");
        });
        // Relay data from the client to the relay process (Unix socket)
        clientSocket.on("data", (chunk) => {
          logger.debug(guid, `Received data from client, sending to Unix socket: ${chunk.length} bytes`);
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

  async killProcess(proc: ChildProcessWithoutNullStreams) {
    try {
      logger.debug("Killing relay process");
      proc.kill();
    } catch (error: any) {
      logger.error("Error killing relay process", error);
    }
    try {
      logger.debug("Unref relay process");
      proc.unref();
    } catch (error: any) {
      logger.error("Unref relay process failed", error);
    }
  }

  async stop() {
    this.isStarted = false;
    Object.keys(this.relayProcesses).forEach((key) => {
      const relayProcess = this.relayProcesses[key];
      if (relayProcess) {
        this.killProcess(relayProcess);
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

export function withWSLRelayServer(connection: Connection, callback: (server: WSLRelayServer) => void) {
  if (!RELAY_SERVERS_CACHE[connection.id]) {
    RELAY_SERVERS_CACHE[connection.id] = new WSLRelayServer();
  }
  callback(RELAY_SERVERS_CACHE[connection.id]);
}

export interface WrapperOpts extends SpawnOptionsWithoutStdio {
  wrapper: Wrapper;
}

export interface ServiceOpts {
  checkStatus: (process: any) => Promise<boolean>;
  retry?: { count: number; wait: number };
  cwd?: string;
  env?: any;
}

// locals
export async function getFreeTCPPort() {
  return new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, function () {
      const address = srv.address() as any;
      srv.close();
      setTimeout(() => {
        resolve(address.port || 31313);
      }, 500);
    });
  });
}

export function createNodeJSApiDriver(config: AxiosRequestConfig) {
  const httpAgent = new http.Agent({
    keepAlive: true,
    keepAliveMsecs: 10,
    timeout: 30000
  });
  httpAgent.maxSockets = 1;
  const driver = axios.create({
    ...config,
    adapter: httpAdapter,
    httpAgent: httpAgent,
    httpsAgent: httpAgent
  });
  // Configure http client logging
  return driver;
}

export async function proxyRequestToWSLDistribution(connection: Connection, config: ApiDriverConfig, request: Partial<AxiosRequestConfig>) {
  return await new Promise<AxiosResponse<any, any> | undefined>((resolve, reject) => {
    //
    withWSLRelayServer(connection, async (server) => {
      // Make actual request to the temporary socket server created above
      let resolved = false;
      try {
        const pipeName = `container-desktop-wsl-relay-${connection.id}`;
        const { started, socketPath, tcpAddress } = await server.start(
          {
            pipeName,
            distribution: connection.settings.controller?.scope || "Ubuntu",
            unixSocketPath: `${connection.settings.api.connection.relay}`.replace("unix://", ""),
            relayProgram: "container-desktop-wsl-relay",
            maxRespawnRetries: 5,
            ping: connection.engine === ContainerEngine.DOCKER
          },
          (_, started) => {
            logger.debug("WSL Relay server started", started);
          },
          (_, code) => {
            logger.debug("WSL Relay server stopped", code);
          },
          // On error
          (_, error) => {
            logger.error("WSL Relay server error", error);
            if (!resolved) {
              resolved = true;
              reject(error);
            }
          }
        );
        if (started) {
          try {
            request.headers = deepMerge({}, config.headers || {}, request.headers || {});
            request.timeout = request.timeout || config.timeout || 1000;
            request.baseURL = tcpAddress || request.baseURL || "http://d";
            request.socketPath = socketPath;
            logger.debug(">> WSL Relay request", request, { socketPath, tcpAddress });
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
  context?: any
): Promise<AxiosResponse<any, any>> {
  const remoteAddress = connection.settings.api.connection.relay ?? "";
  if (SSH_TUNNELS_CACHE[remoteAddress]) {
    logger.debug("Reusing SSH tunnel", remoteAddress, SSH_TUNNELS_CACHE[remoteAddress]);
  } else {
    logger.debug("Creating SSH tunnel", remoteAddress);
    const sshConnection: ISSHClient = await context.getSSHConnection();
    const port = await getFreeTCPPort();
    const localAddress = `localhost:${port}`;
    if (!remoteAddress) {
      throw new Error("Remote address must be set");
    }
    const em = await sshConnection.startTunnel({
      localAddress,
      remoteAddress,
      onStopTunnel: () => {
        delete SSH_TUNNELS_CACHE[remoteAddress];
      }
    });
    if (em) {
      SSH_TUNNELS_CACHE[remoteAddress] = localAddress;
    }
  }
  if (SSH_TUNNELS_CACHE[remoteAddress]) {
    const localAddress = SSH_TUNNELS_CACHE[remoteAddress];
    request.headers = deepMerge({}, config.headers || {}, request.headers || {});
    request.timeout = request.timeout || config.timeout || 5000;
    request.baseURL = request.baseURL || config.baseURL;
    request.socketPath = request.socketPath || config.socketPath;
    const response = await Command.proxyTCPRequest(request, localAddress);
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
  let spawnLauncher;
  let spawnArgs: string[] = [];
  let spawnOpts: any;
  if (await Platform.isFlatpak()) {
    const hostLauncher = "flatpak-spawn";
    const hostArgs = [
      "--host",
      // remove flatpak container VFS prefix when executing
      launcher.replace("/var/run/host", ""),
      ...launcherArgs
    ];
    spawnLauncher = hostLauncher;
    spawnArgs = hostArgs;
    spawnOpts = launcherOpts;
  } else {
    spawnLauncher = launcher;
    spawnArgs = launcherArgs;
    spawnOpts = launcherOpts;
  }
  const spawnLauncherOpts: WrapperOpts = { encoding: "utf-8", ...(spawnOpts || {}) };
  const command = [spawnLauncher, ...spawnArgs].join(" ");
  if (!spawnLauncher) {
    logger.error("[SC.A][>]", command, { spawnLauncher, spawnArgs, spawnLauncherOpts });
    throw new Error("Launcher path must be set");
  }
  if (typeof spawnLauncher !== "string") {
    logger.error("[SC.A][>]", command, { spawnLauncher, spawnArgs, spawnLauncherOpts });
    throw new Error("Launcher path has invalid type");
  }
  logger.debug("[SC.A][>][spawn]", { command: spawnLauncher, args: spawnArgs, opts: spawnLauncherOpts, commandLine: command });
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
    detached: opts?.detached
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
          command: "" // Decorated by child process
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
            logger.debug("[SC.A][<]", { pid: result.pid, code: result.code, success: result.success, command });
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

export async function exec_service(programPath: string, programArgs: string[], opts: ServiceOpts) {
  let isManagedExit = false;
  let child: ChildProcessWithoutNullStreams | undefined;
  const proc: CommandExecutionResult = {
    pid: null,
    code: null,
    success: false,
    stdout: "",
    stderr: ""
  };
  const { checkStatus, retry } = opts;
  const em = new EventEmitter();
  // Check
  const running = await checkStatus({ pid: null, started: false });
  if (running) {
    logger.debug("Already running - reusing");
    proc.success = true;
    setImmediate(() => {
      em.emit("ready", { process: proc, child });
    });
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
    const waitForProcess = (child: ChildProcess) => {
      let pending = false;
      const maxRetries = retry?.count || DEFAULT_RETRIES_COUNT;
      let retries = maxRetries;
      const wait = retry?.wait || 2000;
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
            running = await checkStatus({ pid: child.pid, started: true });
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
            const pid = child.pid;
            em.emit("ready", {
              process: proc,
              child: {
                pid,
                kill: async (signal?: NodeJS.Signals | number) => {
                  logger.debug("(OS) Killing child process started", pid, { signal });
                  try {
                    logger.debug("(OS) Destroying child process streams");
                    if (child.stdout) {
                      child.stdout.destroy();
                    }
                    if (child.stdin) {
                      child.stdin.destroy();
                    }
                    if (child.stderr) {
                      child.stderr.destroy();
                    }
                  } catch (error: any) {
                    logger.error("(OS) Destroying child process streams failed", error);
                  }
                  try {
                    child.kill(signal);
                  } catch (error: any) {
                    logger.error("(OS) Kill child process failed", error);
                  }
                  logger.debug("(OS) Killing child process completed", pid, { child });
                },
                unref: () => {
                  logger.debug("(OS) Unref child process started", pid);
                  try {
                    child.unref();
                  } catch (error: any) {
                    logger.error("(OS) Unref child process failed", error);
                  }
                  logger.debug("(OS) Unref child process completed", pid);
                }
              }
            });
          } else {
            logger.error("Move to next retry", retries);
          }
        }
      }, wait);
    };
    const onStart = async () => {
      const launcherOpts = {
        encoding: "utf-8",
        cwd: opts?.cwd,
        env: opts?.env ? deepMerge({}, process.env, opts?.env || {}) : undefined
      };
      child = await wrapSpawnAsync(programPath, programArgs, launcherOpts);
      proc.pid = child.pid!;
      proc.code = child.exitCode;
      logger.debug("Child process spawned", child.pid, { programPath, programArgs, launcherOpts });
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
    };
    em.on("start", onStart);
    em.emit("start");
  }
  return {
    on: (event, listener, context?: any) => em.on(event, listener, context)
  };
}

export const Command: ICommand = {
  async Spawn(command: string, args?: readonly string[], options?: any) {
    return spawnSync(command, args, options);
  },

  async Execute(launcher: string, args: string[], opts?: WrapperOpts) {
    return await exec_launcher_async(launcher, args, opts);
  },

  async ExecuteAsBackgroundService(launcher: string, args: string[], opts: ServiceOpts) {
    return await exec_service(launcher, args, opts);
  },

  async StartSSHConnection(host: SSHHost, cli?: string) {
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
    return new Promise<ISSHClient>((resolve, reject) => {
      // function Client() {}
      const connection = new SSHClient({ osType: os.type() as OperatingSystem });
      connection.cli = cli ?? (os.type() === OperatingSystem.Windows ? "ssh.exe" : "ssh");
      connection.on("connection.established", () => {
        logger.warn("Connection established", connection);
        // Wrap as object as it is passed from electron to renderer process - that one can't pass class instances
        resolve({
          isConnected: () => connection.isConnected(),
          connect: async (params: SSHClientConnection) => await connection.connect(params),
          execute: async (command: string[]) => await connection.execute(command),
          startTunnel: async (params: { localAddress: string; remoteAddress: string; onStopTunnel: () => void }) => await connection.startTunnel(params),
          stopTunnel: () => connection.stopTunnel(),
          on: (event, listener, context) => connection.on(event, listener, context),
          close: () => connection.close()
        } as ISSHClient);
      });
      connection.on("error", (error: any) => {
        logger.error("SSH connection error", error.message);
        reject(new Error("SSH connection error"));
      });
      const credentials = {
        host: host.HostName,
        port: Number(host.Port) || 22,
        username: host.User,
        privateKeyPath: privateKeyPath
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

  async proxyTCPRequest(request: Partial<AxiosRequestConfig>, tcpAddress: string): Promise<AxiosResponse<any, any>> {
    try {
      const httpAgent = new http.Agent({
        keepAlive: true,
        keepAliveMsecs: 10,
        timeout: 30000
      });
      httpAgent.maxSockets = 1;
      const driver = axios.create({
        adapter: httpAdapter,
        httpAgent: httpAgent,
        httpsAgent: httpAgent,
        baseURL: tcpAddress.startsWith("http") ? tcpAddress : `http://${tcpAddress}`
      });
      request.withCredentials = false;
      const tunneledRequest = { ...request, socketPath: undefined, baseURL: undefined };
      logger.debug(">> Proxying TCP request", request, "tunneled", tunneledRequest);
      const response = await driver.request(tunneledRequest);
      (response as any).success = response.status >= 200 && response.status < 300;
      logger.debug("<< Proxying TCP request success - response", response);
      return response;
    } catch (error: any) {
      let fakeResponse: AxiosResponse<any, any> = {
        status: 500,
        statusText: "Server error",
        data: undefined,
        headers: {},
        config: request as any
      };
      if (error?.response) {
        fakeResponse = error?.response;
      }
      (fakeResponse as any).success = false;
      logger.error("<< Proxying TCP request failed - response", fakeResponse, error);
      return fakeResponse;
    }
  },

  async proxyRequest(request: Partial<AxiosRequestConfig>, connection: Connection, context?: any) {
    let response: AxiosResponse<any, any> | undefined;
    switch (connection.host) {
      case ContainerEngineHost.PODMAN_NATIVE:
      case ContainerEngineHost.DOCKER_NATIVE:
      case ContainerEngineHost.PODMAN_VIRTUALIZED_VENDOR:
      case ContainerEngineHost.DOCKER_VIRTUALIZED_VENDOR:
      case ContainerEngineHost.PODMAN_VIRTUALIZED_LIMA:
      case ContainerEngineHost.DOCKER_VIRTUALIZED_LIMA:
        {
          const config = await getApiConfig(connection.settings.api, connection.settings.controller?.scope, connection.host);
          let curl: string = "";
          try {
            const socketPath = connection?.settings?.api?.connection?.relay || config.socketPath;
            curl = axiosConfigToCURL({ ...config, ...request, socketPath }) as string;
          } catch (error: any) {
            logger.warn("Error converting axios config to CURL", error);
          }
          logger.debug("Proxying request to host", { connection, config, request, curl });
          const driver = await createNodeJSApiDriver(config);
          response = await driver.request(request);
          logger.debug("Proxy response", { data: response?.data, status: response?.status, statusText: response?.statusText });
        }
        break;
      case ContainerEngineHost.PODMAN_VIRTUALIZED_WSL:
      case ContainerEngineHost.DOCKER_VIRTUALIZED_WSL:
        {
          const config = await getApiConfig(connection.settings.api, connection.settings.controller?.scope, connection.host);
          config.socketPath = connection.settings.api.connection.relay;
          logger.debug("Proxying request to WSL distribution", { connection, config, request });
          response = await proxyRequestToWSLDistribution(connection, config, request);
        }
        break;
      case ContainerEngineHost.PODMAN_REMOTE:
      case ContainerEngineHost.DOCKER_REMOTE:
        {
          const config = await getApiConfig(connection.settings.api, connection.settings.controller?.scope, connection.host);
          config.socketPath = connection.settings.api.connection.relay;
          logger.debug("Proxying request to SSH connection", { connection, config });
          response = await proxyRequestToSSHConnection(connection, config, request, context);
        }
        break;
      default:
        logger.error("Unsupported host", connection.host);
        break;
    }
    return response;
  }
};
