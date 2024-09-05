import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import adapter from "axios/lib/adapters/http";
import { EventEmitter } from "eventemitter3";
import { spawn, SpawnOptionsWithoutStdio } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import { v4 } from "uuid";

import { getApiConfig } from "@/container-client/Api.clients";
import { ApiDriverConfig, CommandExecutionResult, Connection, ContainerEngine, Wrapper } from "@/env/Types";
import { createLogger } from "@/logger";
import { getWindowsPipePath } from "@/platform";
import { axiosConfigToCURL } from "@/utils";
import { Platform } from "./node";

const logger = createLogger("shared");

export interface WrapperOpts extends SpawnOptionsWithoutStdio {
  wrapper: Wrapper;
}

// locals
export function createNodeJSApiDriver(config: AxiosRequestConfig) {
  const adapterConfig = {
    ...config,
    adapter
  };
  // console.debug(">> Create NodeJS API driver", adapterConfig);
  const driver = axios.create(adapterConfig);
  // Configure http client logging
  // Add a request interceptor
  driver.interceptors.request.use(
    function (config) {
      logger.debug("[container-client] HTTP request", axiosConfigToCURL(config));
      return config;
    },
    function (error) {
      logger.error("[container-client] HTTP request error", error.message, error.stack);
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
      logger.error("[container-client] HTTP response error", error.message, error.response ? { code: error.response.status, statusText: error.response.statusText } : "");
      return Promise.reject(error);
    }
  );
  return driver;
}

export function proxyRequestToWSLDistribution(connection: Connection, config: ApiDriverConfig, request: Partial<AxiosRequestConfig>) {
  return new Promise<AxiosResponse<any, any>>((resolve, reject) => {
    // Create Windows Named Pipe server
    const PIPE_NAME = `request-guid-${v4()}`;
    const PIPE_PATH = getWindowsPipePath(`${PIPE_NAME}`);
    let response: AxiosResponse<any, any>;
    let lastError;
    let complete = false;
    let resolved = false;
    try {
      const scope = config.scope || connection.settings.controller?.scope || "";
      const server = net.createServer((stream) => {
        stream.on("data", async (c) => {
          const data = c.toString();
          if (data) {
            if (complete) {
              logger.debug("Relaying already handled", data);
              return;
            }
            complete = true;
            const socketPath = `${config.socketPath}`.replace("unix://", "");
            logger.debug("Relaying request to native unix socket", socketPath, data);
            try {
              const command = `printf ${JSON.stringify(data)} | socat -t 10 UNIX-CONNECT:${socketPath} -`;
              const hostLauncher = "wsl.exe";
              const hostArgs: string[] = ["--distribution", scope, "--exec", "bash", "-l", "-c", command];
              const result = await Command.Execute(hostLauncher, hostArgs);
              logger.debug("Relaying response back to named pipe", result);
              const output = result.success ? result.stdout : result.stderr;
              stream.write(output || "");
            } catch (error: any) {
              logger.error("WSL relay communication error", error);
            } finally {
              stream.end();
            }
          }
        });
        stream.on("error", (error) => {
          logger.error("Stream error detected", error);
        });
        stream.on("end", () => {
          server.close();
        });
      });
      const safePipe = PIPE_PATH.replace("npipe://", "");
      server.listen(safePipe.replace("npipe://", ""), async () => {
        // Make actual request to the temporary socket server created above
        logger.debug("Issuing request to windows named pipe server", safePipe);
        const actual = { ...config, socketPath: safePipe };
        const driver = await createNodeJSApiDriver(actual);
        try {
          logger.debug(">> Issuing request started", request);
          response = await driver.request(request);
          if (!resolved) {
            resolved = true;
            resolve(response);
          }
        } catch (error: any) {
          lastError = error;
          logger.error("WSL relay - Request invocation error", error.message, error.status, error.code, error);
          response = error.response;
          if (!resolved) {
            resolved = true;
            reject(error);
          }
        }
      });
    } catch (error: any) {
      reject(error);
    }
  });
}

// Commander
export function applyWrapper(launcher: string, args: string[], opts: WrapperOpts) {
  let commandLauncher = launcher;
  let commandArgs = args || [];
  if (opts?.wrapper) {
    commandLauncher = opts.wrapper.launcher;
    commandArgs = [...opts.wrapper.args, launcher, ...args];
  }
  // console.debug("Applied wrapper", { launcher, args }, ">>>", { launcher: commandLauncher, args: commandArgs });
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
  logger.debug("[SC.A][>][spawn]", command);
  const child = spawn(spawnLauncher, spawnArgs, spawnLauncherOpts);
  // store for tracing and debugging
  (child as any).command = command;
  return child;
}

export async function exec_launcher_async(launcher: string, launcherArgs: string[], opts: WrapperOpts) {
  // const env = merge({}, { PODMAN_IGNORE_CGROUPSV1_WARNING: "true" }, opts?.env || {});
  const spawnOpts = {
    encoding: "utf-8", // TODO: not working for spawn - find alternative
    cwd: opts?.cwd,
    env: opts?.env || undefined,
    detached: opts?.detached
  };
  const { commandLauncher, commandArgs } = applyWrapper(launcher, launcherArgs, opts);
  return new Promise<CommandExecutionResult>((resolve, reject) => {
    let resolved = false;
    return wrapSpawnAsync(commandLauncher, commandArgs, spawnOpts)
      .then((child) => {
        //
        const process: CommandExecutionResult = {
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
            process.pid = child.pid as any;
            process.code = child.exitCode as any;
            process.stderr = process.stderr || "";
            process.success = child.exitCode === 0;
            process.command = command;
            resolved = true;
            logger.debug("[SC.A][<]", { pid: process.pid, code: process.code, success: process.success, command });
            resolve(process);
          }
        };
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.on("exit", (code) => processResolve("exit", code));
        // child.on("close", (code) => processResolve("close", code));
        child.on("error", (error) => {
          logger.error(command, "spawning error", error.message);
          (process as any).error = error;
          processResolve("error", error);
        });
        child.stdout.on("data", (data) => {
          process.stdout += `${data}`;
        });
        child.stderr.on("data", (data) => {
          logger.warn(command, data);
          process.stderr += `${data}`;
        });
      })
      .catch(reject);
  });
}

export async function exec_launcher(launcher, launcherArgs, opts?: any) {
  return await exec_launcher_async(launcher, launcherArgs, opts);
}

export async function exec_service(opts) {
  let isManagedExit = false;
  let child;
  const process = {
    pid: null,
    code: null,
    success: false,
    stdout: "",
    stderr: ""
  };
  const { checkStatus, retry, programPath, programArgs } = opts;
  const em = new EventEmitter();
  // Check
  const running = await checkStatus();
  if (running) {
    logger.debug("Already running - reusing");
    process.success = true;
    setImmediate(() => {
      em.emit("ready", { process, child });
    });
  } else {
    // Handle
    const onProcessError = (child, error) => {
      logger.error("Child process error", error.code, error.message);
      em.emit("error", { type: "process.error", code: error.code });
    };
    const onProcessExit = (child, code) => {
      logger.debug("Child process exit", code);
      em.emit("exit", { code, managed: isManagedExit });
      isManagedExit = false;
    };
    const onProcessClose = (child, code) => {
      logger.debug("Child process close", code);
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
    const waitForProcess = (child) => {
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
            process.success = true;
            em.emit("ready", {
              process,
              child: {
                kill: (signal: string) => {
                  try {
                    logger.debug("Killing child process");
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
        env: opts?.env
      };
      child = await wrapSpawnAsync(programPath, programArgs, launcherOpts);
      process.pid = child.pid;
      process.code = child.exitCode;
      child.on("exit", (code) => onProcessExit(child, code));
      child.on("close", (code) => onProcessClose(child, code));
      child.on("error", (error) => onProcessError(child, error));
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (data) => onProcessData(child, "stdout", data.toString()));
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (data) => onProcessData(child, "stderr", data.toString()));
      if (typeof child.pid === "undefined") {
        process.success = false;
        logger.error("Child process spawn failure", process);
      } else {
        process.success = !child.killed;
        logger.debug("Child process spawn success", process);
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
  async Execute(launcher: string, args: string[], opts?: any) {
    return await exec_launcher_async(launcher, args, opts);
  },

  async StartService(opts?: any) {
    return await exec_service(opts);
  },

  async StartSSHConnection(opts: SSHHost) {
    const homeDir = await Platform.getHomeDir();
    let privateKeyPath = await Path.join(homeDir, ".ssh/id_rsa");
    if (opts.IdentityFile) {
      privateKeyPath = opts.IdentityFile;
      if (privateKeyPath.startsWith("~")) {
        privateKeyPath = privateKeyPath.replace("~", homeDir);
      }
      if (privateKeyPath.includes("$HOME")) {
        privateKeyPath = privateKeyPath.replace("$HOME", homeDir);
      }
    }
    return new Promise((resolve, reject) => {
      function Client() {}
      const connection = new Client();
      connection.on("ready", () => {
        logger.debug("Connection ready", connection);
        resolve({
          connected: true,
          exec: (command, callback) => connection.exec(command, callback),
          stop: () => connection.end()
        });
      });
      connection.on("error", (error: any) => {
        logger.error("SSH connection error", error.message);
        reject(new Error("SSH connection error"));
      });
      const credentials = {
        host: opts.HostName,
        port: Number(opts.Port) || 22,
        username: opts.User,
        privateKey: fs.readFileSync(privateKeyPath)
      };
      logger.debug("Connecting to SSH server using", credentials);
      connection.connect(credentials);
      return {
        on: (event, listener, context) => connection.on(event, listener, context)
      };
    });
  },

  async proxyRequest(request: Partial<AxiosRequestConfig>, connection: Connection) {
    let response: AxiosResponse<any, any> | undefined;
    switch (connection.engine) {
      case ContainerEngine.PODMAN_NATIVE:
      case ContainerEngine.DOCKER_NATIVE:
      case ContainerEngine.PODMAN_VIRTUALIZED_VENDOR:
      case ContainerEngine.DOCKER_VIRTUALIZED_VENDOR:
      case ContainerEngine.PODMAN_VIRTUALIZED_LIMA:
      case ContainerEngine.DOCKER_VIRTUALIZED_LIMA:
        {
          const config = getApiConfig(connection.settings.api, connection.settings.controller?.scope);
          logger.debug("Proxying request", { connection, config });
          const driver = await createNodeJSApiDriver(config);
          response = await driver.request(request);
          logger.debug("Proxy response", response);
        }
        break;
      case ContainerEngine.PODMAN_VIRTUALIZED_WSL:
      case ContainerEngine.DOCKER_VIRTUALIZED_WSL:
        {
          const config = getApiConfig(connection.settings.api, connection.settings.controller?.scope);
          config.socketPath = connection.settings.api.connection.relay;
          logger.debug("Proxying request", { connection, config });
          response = await proxyRequestToWSLDistribution(connection, config, request);
        }
        break;
      default:
        break;
    }
    return response;
  }
};
