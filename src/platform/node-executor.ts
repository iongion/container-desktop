import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import adapter from "axios/lib/adapters/http";
import { EventEmitter } from "eventemitter3";
// import fetch from "node-fetch";
import { ChildProcess, ChildProcessWithoutNullStreams, spawn, SpawnOptionsWithoutStdio } from "node:child_process";
import http from "node:http";
import net from "node:net";
import os from "node:os";

import { getApiConfig } from "@/container-client/Api.clients";
import { ISSHClient, SSHClient, SSHClientConnection } from "@/container-client/services";
import { ApiDriverConfig, CommandExecutionResult, Connection, ContainerEngineHost, EngineConnectorSettings, OperatingSystem, Wrapper } from "@/env/Types";
import { createLogger } from "@/logger";
import { deepMerge } from "@/utils";
import { Platform } from "./node";

const logger = createLogger("shared");
const SSH_TUNNELS_CACHE: { [key: string]: string } = {};
const RELAY_SERVERS_CACHE: { [key: string]: RelayServer } = {};

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

export class RelayServer {
  protected _connection: Connection;
  protected _server: net.Server;
  protected _address: string = "";
  protected isListening: boolean = false;

  constructor(conn: Connection) {
    this._connection = conn;
    this._server = net.createServer((stream) => {
      stream.on("data", async (c) => {
        const data = c.toString();
        if (data) {
          const scope = conn.settings.controller?.scope || "";
          const socketPath = `${conn.settings.api.connection.relay}`.replace("unix://", "");
          const relayMethod = conn.settings.api.connection.relayMethod || "netcat";
          logger.debug("Relaying request to native unix socket", socketPath, data);
          try {
            let command = `printf ${JSON.stringify(data)} | socat -t 10 UNIX-CONNECT:${socketPath} -`;
            if (relayMethod === "netcat") {
              command = `printf ${JSON.stringify(data)} | nc -U ${socketPath}`;
            }
            const hostLauncher = "wsl.exe";
            const hostArgs: string[] = ["--distribution", scope, "--exec", "bash", "-l", "-c", command];
            const result = await exec_buffered(hostLauncher, hostArgs, (chunk) => {
              logger.debug("Relaying chunk to listening address", { chunk, socketPath });
              stream.write(chunk);
            });
            logger.debug("Relaying complete response", result.exitCode, "to", this._address);
            // stream.write(result.stdout);
          } catch (error: any) {
            logger.error("Relay communication error", error);
          } finally {
            // stream.end();
          }
        }
      });
      stream.on("error", (error) => {
        logger.error("Stream error detected", error);
      });
    });
  }
  getAddress() {
    return this._address;
  }
  async start(): Promise<RelayServer> {
    if (this.isListening) {
      return this;
    }
    const address = this._connection.settings.api.connection.uri || "";
    return new Promise((resolve, reject) => {
      logger.debug(this._connection.id, "Relay server starting", address);
      this._address = address;
      this._server.listen(address, () => {
        logger.debug(this._connection.id, "Relay server started", address);
        this.isListening = true;
        resolve(this);
      });
    });
  }
  async stop() {
    this.isListening = false;
    this._server.close();
  }
}

export function withConnectionRelayServer(connection: Connection, callback: (server: RelayServer) => void) {
  if (!RELAY_SERVERS_CACHE[connection.id]) {
    RELAY_SERVERS_CACHE[connection.id] = new RelayServer(connection);
  }
  callback(RELAY_SERVERS_CACHE[connection.id]);
}

export interface WrapperOpts extends SpawnOptionsWithoutStdio {
  wrapper: Wrapper;
}

export interface ServiceOpts {
  checkStatus: () => Promise<boolean>;
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
  const adapterConfig = {
    ...config,
    adapter
  };
  // logger.debug(">> Create NodeJS API driver", adapterConfig);
  const driver = axios.create(adapterConfig);
  // Configure http client logging
  return driver;
}

export async function proxyRequestToWSLDistribution(connection: Connection, config: ApiDriverConfig, request: Partial<AxiosRequestConfig>) {
  return await new Promise<AxiosResponse<any, any> | undefined>((resolve, reject) => {
    //
    withConnectionRelayServer(connection, async (server) => {
      // Make actual request to the temporary socket server created above
      try {
        await server.start();
        const actual = deepMerge({}, config, request, { socketPath: server.getAddress() });
        const driver = await createNodeJSApiDriver(actual);
        const response = await driver.request(actual);
        resolve(response);
      } catch (error: any) {
        reject(error);
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
  logger.debug("[SC.A][>][spawn]", { command: spawnLauncher, args: spawnArgs, opts: spawnLauncherOpts });
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
  const running = await checkStatus();
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
      let retries = retry?.count || 15;
      const wait = retry?.wait || 1000;
      const IID = setInterval(async () => {
        if (pending) {
          logger.debug("Waiting for result of last retry - skipping new retry");
          return;
        }
        logger.debug("Remaining", retries, "of", retry?.count);
        if (retries === 0) {
          clearInterval(IID);
          logger.error("Max retries reached");
          em.emit("error", { type: "domain.max-retries", code: undefined });
        } else {
          retries -= 1;
          pending = true;
          let running = false;
          try {
            running = await checkStatus();
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
                kill: (signal: NodeJS.Signals | number) => {
                  try {
                    logger.debug("Killing child process", pid);
                    child.kill(signal);
                  } catch (error: any) {
                    logger.error("Kill child process failed", error);
                  }
                  try {
                    logger.debug("Dereferencing child process");
                    child.unref();
                  } catch (error: any) {
                    logger.error("Dereferencing child process failed", error);
                  }
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
        adapter,
        httpAgent: httpAgent,
        httpsAgent: httpAgent,
        baseURL: `http://${tcpAddress}`
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
        config: request
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
          const config = getApiConfig(connection.settings.api, connection.settings.controller?.scope);
          logger.debug("Proxying request to host", { connection, config });
          const driver = await createNodeJSApiDriver(config);
          response = await driver.request(request);
          logger.debug("Proxy response", response);
        }
        break;
      case ContainerEngineHost.PODMAN_VIRTUALIZED_WSL:
      case ContainerEngineHost.DOCKER_VIRTUALIZED_WSL:
        {
          const config = getApiConfig(connection.settings.api, connection.settings.controller?.scope);
          config.socketPath = connection.settings.api.connection.relay;
          logger.debug("Proxying request to WSL distribution", { connection, config });
          response = await proxyRequestToWSLDistribution(connection, config, request);
        }
        break;
      case ContainerEngineHost.PODMAN_REMOTE:
      case ContainerEngineHost.DOCKER_REMOTE:
        {
          const config = getApiConfig(connection.settings.api, connection.settings.controller?.scope);
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
