import EventEmitter from "eventemitter3";
import { type CommandExecutionResult, OperatingSystem, type SpawnedProcess } from "@/env/Types";
import { createLogger } from "@/platform/logger";
import { runSSHPreflight } from "./diagnostics/ssh-preflight";
import {
  buildSSHArgs,
  buildSSHConnectionURI,
  buildSSHTunnelArgs,
  SSH_CONNECT_TIMEOUT_SECONDS,
  type SSHClientConnection,
} from "./ssh-args";

// Re-exported so existing importers (and tests) keep resolving these from "@/container-client/services".
export {
  buildSSHArgs,
  buildSSHConnectionURI,
  buildSSHTunnelArgs,
  SSH_CONNECT_TIMEOUT_SECONDS,
  type SSHClientConnection,
};

const logger = createLogger("ssh.client");
const SSH_COMMAND_TIMEOUT_MS = (SSH_CONNECT_TIMEOUT_SECONDS + 5) * 1000;

export interface ISSHClient {
  isConnected: () => boolean;
  on: (event: string, listener: (...args: any[]) => void, context?: any) => void;
  emit: (event: string, ...args: any[]) => boolean;
  connect: (params: SSHClientConnection) => Promise<void>;
  execute: (command: string[]) => Promise<CommandExecutionResult>;
  executeStreaming: (command: string[]) => Promise<StreamHandle>;
  startTunnel: (config: {
    localAddress: string;
    remoteAddress: string;
    onStatusCheck: (status: any) => void;
    onStopTunnel: () => void;
  }) => Promise<EventEmitter>;
  // Bridge a local IPC socket/pipe to a raw `<engine> system dial-stdio` channel over SSH — the data plane for
  // a remote whose engine API is a named pipe (Windows Docker), which can't be `ssh -NL` forwarded. No TCP.
  // Provided by the platform-side rewrap (ssh-transport.ts); the SSHClient class does not implement it.
  startStdioBridge?: (config: {
    localAddress: string;
    command: string[];
  }) => Promise<{ stop: () => Promise<void> } | undefined>;
  stopTunnel: () => void;
  close: () => void;
}

export class SSHClient implements ISSHClient {
  protected em: EventEmitter;
  protected params!: SSHClientConnection;
  protected connected = false;
  protected cli = "";
  protected osType: OperatingSystem = OperatingSystem.Unknown;
  protected nativeApiStarterProcess: CommandExecutionResult | null = null;
  protected nativeApiStarterProcessChild: SpawnedProcess | null = null;
  protected onStopTunnel?: () => void;
  constructor({ cli, osType }: { cli: string; osType: OperatingSystem }) {
    this.em = new EventEmitter();
    this.cli = cli;
    this.osType = osType;
  }
  isConnected() {
    return this.connected;
  }
  on(event: string, listener: (...args: any[]) => void, context?: any) {
    this.em.on(event, listener, context);
  }
  emit(event: string, ...args: any[]) {
    return this.em.emit(event, ...args);
  }
  async connect(params: SSHClientConnection) {
    this.params = params;
    const output = await Command.Execute(this.cli, buildSSHArgs(params, ["echo", "SSH connection established"]), {
      timeout: SSH_COMMAND_TIMEOUT_MS,
    });
    if (output.success && output.stdout.trim() === "SSH connection established") {
      this.connected = true;
      this.em.emit("connection.established");
      return;
    }
    // The probe failed. Diagnose WHY so the UI can show an actionable reason instead of raw output
    // (#186 "no connection, no reason"); the preflight is itself bounded, so this can't hang (#171).
    this.connected = false;
    const report = await runSSHPreflight(
      {
        hostName: params.host,
        port: params.port,
        user: params.username,
        identityFile: params.privateKeyPath,
        configHost: params.configHost,
      },
      { osType: this.osType },
    );
    this.em.emit("error", { output, report });
  }
  async execute(command: string[]) {
    return await Command.Execute(this.cli, buildSSHArgs(this.params, command), { timeout: SSH_COMMAND_TIMEOUT_MS });
  }
  async executeStreaming(command: string[]): Promise<StreamHandle> {
    // A build streams for as long as it takes — no command timeout (unlike execute()).
    return await Command.ExecuteStreaming(this.cli, buildSSHArgs(this.params, command));
  }
  async startTunnel(config: {
    localAddress: string;
    remoteAddress: string;
    onStatusCheck: (status: any) => void;
    onStopTunnel: () => void;
  }): Promise<EventEmitter> {
    const remoteAddress = config.remoteAddress.replace("unix://", "").replace("UNIX://", "");
    // Plain OpenSSH unix-socket forward (`ssh -NL`). Non-Windows only — the transport refuses this path on
    // Windows, where the engine's own `system dial-stdio` bridge is used instead.
    const spawnCLI = this.cli;
    const spawnArgs = buildSSHTunnelArgs(this.params, config.localAddress, remoteAddress);
    logger.debug("Starting SSH tunnel", {
      osType: this.osType,
      spawnCLI,
      localAddress: config.localAddress,
      remoteAddress,
    });
    if (!config.localAddress) {
      throw new Error("Local address not provided");
    }
    const driver = await Command.CreateNodeJSApiDriver({
      socketPath: config.localAddress,
      baseURL: "http://d",
    });
    return new Promise((resolve, reject) => {
      let resolved = false;
      logger.debug("Starting SSH tunnel background service", {
        localAddress: config.localAddress,
        remoteAddress: config.remoteAddress,
      });
      return Command.ExecuteAsBackgroundService(spawnCLI, spawnArgs, {
        // Bound the SSH-tunnel API-readiness probe. A remote whose engine daemon isn't serving (e.g. an
        // Apple `container`/socktainer that's installed but not running) would otherwise be polled the full
        // default 10×2s = 20s before failing — the "forever" hang on boot. A healthy remote answers /_ping
        // on the first check, so this shorter ceiling (5×2s = 10s) only shortens the dead-remote wait; it
        // never cuts a working connection.
        retry: { count: 5, wait: 2000 },
        onStatusCheck: ({ retries, maxRetries }) => {
          logger.debug("Checked SSH tunnel status", { retries, maxRetries });
          if (config?.onStatusCheck) {
            config.onStatusCheck({ retries, maxRetries });
          }
        },
        onSpawn: ({ process, child }) => {
          this.nativeApiStarterProcess = process;
          this.nativeApiStarterProcessChild = child;
          this.onStopTunnel = config.onStopTunnel;
        },
        checkStatus: async () => {
          try {
            logger.debug("Checking SSH tunnel status", {
              localAddress: config.localAddress,
              remoteAddress: config.remoteAddress,
            });
            const response = await driver.request({
              method: "GET",
              url: "/_ping",
              socketPath: config.localAddress,
            });
            return response.status === 200;
          } catch (error: any) {
            logger.debug("SSH tunnel status check failed", { message: `${error?.message ?? error}` });
            return false;
          }
        },
      })
        .then((client) => {
          client.on("error", (error: any) => {
            if (!resolved) reject(error);
            resolved = true;
          });
          client.on("ready", async ({ process, child }: { process: CommandExecutionResult; child: SpawnedProcess }) => {
            logger.info("SSH client tunnel started", { pid: child?.pid, code: process?.code });
            resolved = true;
            resolve(client);
          });
        })
        .catch((error: any) => {
          logger.error("SSH client tunnel start failed", { message: error.message });
          if (!resolved) reject(error);
          resolved = true;
        });
    });
  }
  stopTunnel() {
    logger.info("Stopping SSH client tunnel");
    if (this.onStopTunnel) {
      this.onStopTunnel();
    }
  }
  close() {
    logger.debug("Closing SSH connection");
    this.stopTunnel();
    const child = this.nativeApiStarterProcessChild;
    if (child) {
      logger.info("Terminating SSH client tunnel child process", { pid: child.pid });
      try {
        child.kill();
        this.nativeApiStarterProcessChild = null;
        logger.info("SSH client tunnel stopped", { pid: child.pid, code: this.nativeApiStarterProcess?.code });
      } catch (error: any) {
        logger.warn("SSH client tunnel stop failed", { message: error.message });
      }
    } else {
      logger.debug("No SSH client tunnel found - nothing to stop");
    }
  }
}
