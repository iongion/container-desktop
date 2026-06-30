import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import net from "node:net";
import type { AxiosRequestConfig, AxiosResponse } from "axios";
import type { ApiDriverConfig, Connection } from "@/env/Types";
import { createLogger } from "@/logger";
import { Path } from "@/platform/node";
import { isEmpty } from "@/utils";
import {
  applyProxyRequestDefaults,
  connectionSummary,
  createNodeJSApiDriver,
  errorSummary,
  requestSummary,
  responseSummary,
  socketLabel,
} from "./api-driver";
import { exec_launcher_async } from "./commander";
import { killProcess } from "./process-utils";

const logger = createLogger("platform.wsl");

const RELAY_SERVERS_CACHE: { [key: string]: WSLRelayServer } = {};

const PROGRAM_WSL_RELAY = "container-desktop-relay";

// Servers
async function getWSLDistributionEnvironmentVariable(distribution: string, variable: string) {
  // `: any` mirrors the original call through the ambient `Command.Execute` (whose return type resolves
  // to `any` in global.d.ts); accessing `.stdout` keeps the exact prior behavior under strictNullChecks.
  const wslCommandOutput: any = await exec_launcher_async("wsl.exe", [
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
  const command: any = await exec_launcher_async("wsl.exe", [
    "--distribution",
    distribution,
    "--exec",
    "wslpath",
    windowsPath,
  ]);
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
    const out = await exec_launcher_async("wsl.exe", ["--distribution", distribution, "--exec", "sha256sum", wslPath]);
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
  await exec_launcher_async("wsl.exe", ["--distribution", distribution, "--exec", "mkdir", "-p", baseDirectory]);
  // Copy only when the destination is missing or doesn't match the bundled binary
  // (self-healing across upgrades), then verify integrity before it is ever executed.
  if (!(await wslFileHasSha256(distribution, dstWSLPath, expectedHash))) {
    await exec_launcher_async("wsl.exe", ["--distribution", distribution, "--exec", "cp", srcWSLPath, dstWSLPath]);
    await exec_launcher_async("wsl.exe", ["--distribution", distribution, "--exec", "chmod", "+x", dstWSLPath]);
    if (expectedHash && !(await wslFileHasSha256(distribution, dstWSLPath, expectedHash))) {
      throw new Error(`Relay program integrity verification failed for ${dstWSLPath}`);
    }
  }
  return dstWSLPath;
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

/** Stop and drop a connection's cached WSL relay server. Backs the facade's `StopConnectionServices`. */
export async function stopRelayServer(connection_id: string): Promise<void> {
  if (RELAY_SERVERS_CACHE[connection_id]) {
    await RELAY_SERVERS_CACHE[connection_id].stop();
    delete RELAY_SERVERS_CACHE[connection_id];
  }
}

/** Clear the WSL relay server cache. Composed into the facade's `__resetConnectionCaches` (test-only). */
export function resetRelayServersCache() {
  for (const key of Object.keys(RELAY_SERVERS_CACHE)) {
    delete RELAY_SERVERS_CACHE[key];
  }
}
