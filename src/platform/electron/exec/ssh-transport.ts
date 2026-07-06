import { spawn } from "node:child_process";
import os from "node:os";
import type { AxiosRequestConfig, AxiosResponse } from "axios";
import type { EventEmitter } from "eventemitter3";
import { type ISSHClient, SSHClient, type SSHClientConnection } from "@/container-client/services";
import { buildSSHArgs } from "@/container-client/ssh-args";
import { type ApiDriverConfig, type Connection, OperatingSystem, type ServiceOpts } from "@/env/Types";
import { Platform } from "@/platform/electron/host";
import { createLogger } from "@/platform/logger";
import { expandHome } from "@/utils";
import {
  applyProxyRequestDefaults,
  connectionSummary,
  createNodeJSApiDriver,
  requestSummary,
  socketLabel,
} from "./api-driver";
import { SSHStdioBridgeServer, type StdioChannel } from "./ssh-stdio-bridge";

const logger = createLogger("platform.ssh");

const SSH_TUNNELS_CACHE: { [key: string]: string } = {};
// One long-lived dial-stdio bridge per remote npipe endpoint (Windows Docker), keyed like the tunnel cache.
const SSH_BRIDGES: { [key: string]: { stop: () => Promise<void> } } = {};

/** Clear the SSH tunnel cache. Composed into the facade's `__resetConnectionCaches` (test-only). */
export function resetSSHTunnelsCache() {
  for (const key of Object.keys(SSH_TUNNELS_CACHE)) {
    delete SSH_TUNNELS_CACHE[key];
  }
  for (const key of Object.keys(SSH_BRIDGES)) {
    void SSH_BRIDGES[key]?.stop();
    delete SSH_BRIDGES[key];
  }
}

export async function proxyRequestToSSHConnection(
  connection: Connection,
  config: ApiDriverConfig,
  request: Partial<AxiosRequestConfig>,
  context?: any,
): Promise<AxiosResponse<any, any>> {
  const remoteAddress = connection.settings.api.connection.relay ?? "";
  const localAddress = connection.settings.api.connection.uri ?? "";
  // When the dialect resolved a stdio-bridge command (the engine can't be `ssh -NL` forwarded — a Windows
  // Docker named pipe, or a Podman machine whose socket lives inside a VM), bridge over SSH stdio by running
  // THAT command. Unified across engines: the transport just runs it. Everything else keeps the `ssh -NL` forward.
  const dialStdioCommand = connection.settings.api.connection.dialStdioCommand;
  if (SSH_TUNNELS_CACHE[remoteAddress]) {
    logger.debug("Reusing SSH tunnel", {
      remote: socketLabel(remoteAddress),
      local: socketLabel(SSH_TUNNELS_CACHE[remoteAddress]),
    });
  } else {
    const useDialStdio = !!dialStdioCommand && dialStdioCommand.length > 0;
    logger.debug(useDialStdio ? "Creating SSH dial-stdio bridge" : "Creating SSH tunnel", {
      remote: socketLabel(remoteAddress),
      local: socketLabel(localAddress),
    });
    const sshConnection: ISSHClient = await context.getSSHConnection();
    if (!remoteAddress) {
      // The remote engine socket could not be resolved — usually the engine isn't installed/running on
      // the remote host, or its CLI isn't on the non-interactive SSH PATH (so socket auto-detection failed).
      throw new Error(
        "Remote engine socket could not be determined — is the container engine installed and running on the remote host (and reachable on a non-interactive SSH PATH)?",
      );
    }
    if (dialStdioCommand && dialStdioCommand.length > 0) {
      if (!sshConnection.startStdioBridge) {
        throw new Error("This build cannot bridge the engine over SSH stdio");
      }
      const bridge = await sshConnection.startStdioBridge({
        localAddress,
        command: dialStdioCommand,
      });
      if (bridge) {
        SSH_BRIDGES[remoteAddress] = bridge;
        SSH_TUNNELS_CACHE[remoteAddress] = localAddress;
      }
    } else {
      // No dial-stdio bridge ⇒ a plain `ssh -NL` unix-socket forward. Windows has no unix-socket forwarding,
      // and every Windows-reachable engine now emits a dial-stdio command, so refuse here rather than spawn a
      // tunnel that cannot work.
      if ((os.type() as OperatingSystem) === OperatingSystem.Windows) {
        throw new Error(
          "No dial-stdio bridge for this SSH connection — the remote engine must support `<engine> system dial-stdio`.",
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
  return new Promise<ISSHClient>((resolve, reject) => {
    const connection = new SSHClient({
      osType: os.type() as OperatingSystem,
      cli: isWindows ? "ssh.exe" : "ssh",
    });
    connection.on("connection.established", () => {
      logger.debug("Connection established", connection);
      // Wrap as object as it is passed from electron to renderer process - that one can't pass class instances
      resolve({
        isConnected: () => connection.isConnected(),
        connect: async (params: SSHClientConnection) => await connection.connect(params),
        execute: async (command: string[]) => await connection.execute(command),
        executeStreaming: async (command: string[]) => await connection.executeStreaming(command),
        startStdioBridge: async (params: { localAddress: string; command: string[] }) => {
          // Per client connection, open a raw `ssh <host> -- <command>` channel (Buffers, never utf-8-decoded)
          // and let the bridge server shuttle bytes to/from the local IPC listener. No TCP.
          const sshCli = isWindows ? "ssh.exe" : "ssh";
          const makeChannel = (): StdioChannel => {
            const child = spawn(sshCli, buildSSHArgs(credentials, params.command));
            return {
              stdin: child.stdin as NodeJS.WritableStream,
              stdout: child.stdout as NodeJS.ReadableStream,
              kill: () => {
                try {
                  child.kill();
                } catch {
                  /* already gone */
                }
              },
              onExit: (cb: () => void) => {
                child.on("exit", cb);
                child.on("error", cb);
              },
            };
          };
          const server = new SSHStdioBridgeServer(params.localAddress, makeChannel);
          const started = await server.start();
          return started ? server : undefined;
        },
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
