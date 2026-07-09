import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import net from "node:net";
import type { AxiosRequestConfig, AxiosResponse } from "axios";
import { buildWSLDialStdioArgs } from "@/container-client/wsl-args";
import type { ApiDriverConfig, Connection, ContainerEngine } from "@/env/Types";
import { createLogger } from "@/platform/logger";
import { isEmpty } from "@/utils";
import { randomUUID } from "@/utils/randomUUID";
import {
  applyProxyRequestDefaults,
  connectionSummary,
  createNodeJSApiDriver,
  errorSummary,
  requestSummary,
  responseSummary,
  socketLabel,
} from "./api-driver";
import { killProcess } from "./process-utils";

const logger = createLogger("platform.wsl");

const RELAY_SERVERS_CACHE: { [key: string]: WSLRelayServer } = {};

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
      engine,
      program,
      unixSocketPath,
      maxRespawnRetries,
      abort,
    }: {
      pipePath: string;
      distribution: string;
      engine: ContainerEngine;
      program: string;
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
    let args: string[] = [];
    try {
      maxRespawnRetries = maxRespawnRetries || 5;
      // Bridge the engine's in-distro API socket to wsl.exe stdio by running the engine's OWN
      // `system dial-stdio` inside the distribution (named pipe <-> stdio <-> unix socket). Nothing is
      // copied into the distro — we exec the podman/docker that already lives there.
      args = buildWSLDialStdioArgs({ distribution, program, engine, socketPath: unixSocketPath });
      pipeFullPath = pipePath;
      this.socketPath = pipeFullPath;
    } catch (error: any) {
      logger.error("Error preparing WSL dial-stdio bridge", error.message);
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
        const guid = randomUUID();
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
            engine: connection.engine,
            program: connection.settings.program.name || connection.engine,
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

// Stop and drop a connection's cached WSL relay server. Backs the facade's `StopConnectionServices`.
export async function stopRelayServer(connection_id: string): Promise<void> {
  if (RELAY_SERVERS_CACHE[connection_id]) {
    await RELAY_SERVERS_CACHE[connection_id].stop();
    delete RELAY_SERVERS_CACHE[connection_id];
  }
}

// Clear the WSL relay server cache. Composed into the facade's `__resetConnectionCaches` (test-only).
export function resetRelayServersCache() {
  for (const key of Object.keys(RELAY_SERVERS_CACHE)) {
    delete RELAY_SERVERS_CACHE[key];
  }
}
