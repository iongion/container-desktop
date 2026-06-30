import os from "node:os";
import type { AxiosRequestConfig, AxiosResponse } from "axios";
import type { EventEmitter } from "eventemitter3";
import { type ISSHClient, SSHClient, type SSHClientConnection } from "@/container-client/services";
import { type ApiDriverConfig, type Connection, OperatingSystem, type ServiceOpts } from "@/env/Types";
import { createLogger } from "@/logger";
import { Path, Platform } from "@/platform/node";
import { expandHome } from "@/utils";
import {
  applyProxyRequestDefaults,
  connectionSummary,
  createNodeJSApiDriver,
  requestSummary,
  socketLabel,
} from "./api-driver";

const logger = createLogger("platform.ssh");

const SSH_TUNNELS_CACHE: { [key: string]: string } = {};

/** Clear the SSH tunnel cache. Composed into the facade's `__resetConnectionCaches` (test-only). */
export function resetSSHTunnelsCache() {
  for (const key of Object.keys(SSH_TUNNELS_CACHE)) {
    delete SSH_TUNNELS_CACHE[key];
  }
}

const PROGRAM_SSH_RELAY = "container-desktop-ssh-relay.exe";

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

export async function startSSHConnection(host: SSHHost, opts?: Partial<ServiceOpts>): Promise<ISSHClient> {
  const homeDir = await Platform.getHomeDir();
  const privateKeyPath = host.IdentityFile ? expandHome(host.IdentityFile, homeDir) : "";
  host.IdentityFile = privateKeyPath;
  const isWindows = (os.type() as OperatingSystem) === OperatingSystem.Windows;
  const sshRelayProgramCLI = isWindows ? await Path.join(process.env.APP_PATH || "", "bin", PROGRAM_SSH_RELAY) : "ssh";
  return new Promise<ISSHClient>((resolve, reject) => {
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
      // `error` is either a raw CommandExecutionResult or { output, report } from the preflight.
      // Surface the first concrete failure reason instead of a generic message so the caller/UI
      // can explain why, and attach the structured report for richer display.
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
}
