import EventEmitter from "eventemitter3";
import { type CommandExecutionResult, OperatingSystem, type SpawnedProcess } from "@/env/Types";

export interface SSHClientConnection {
  host: string;
  port: number;
  username: string;
  privateKeyPath: string;
}

export interface ISSHClient {
  isConnected: () => boolean;
  on: (event: string, listener: (...args: any[]) => void, context?: any) => void;
  emit: (event: string, ...args: any[]) => boolean;
  connect: (params: SSHClientConnection) => Promise<void>;
  execute: (command: string[]) => Promise<CommandExecutionResult>;
  startTunnel: (config: {
    localAddress: string;
    remoteAddress: string;
    onStatusCheck: (status: any) => void;
    onStopTunnel: () => void;
  }) => Promise<EventEmitter>;
  stopTunnel: () => void;
  close: () => void;
}

export class SSHClient implements ISSHClient {
  protected em: EventEmitter;
  protected params!: SSHClientConnection;
  protected connected = false;
  protected cli = "";
  protected relayCLI = "";
  protected osType: OperatingSystem = OperatingSystem.Unknown;
  protected nativeApiStarterProcess: CommandExecutionResult | null = null;
  protected nativeApiStarterProcessChild: SpawnedProcess | null = null;
  protected onStopTunnel?: () => void;
  constructor({ cli, relayCLI, osType }: { cli: string; relayCLI: string; osType: OperatingSystem }) {
    this.em = new EventEmitter();
    this.cli = cli;
    this.relayCLI = relayCLI ?? cli;
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
    const output = await Command.Execute(this.cli, [
      // SSH connection options
      "-oStrictHostKeyChecking=no",
      "-oUserKnownHostsFile=/dev/null",
      "-i",
      params.privateKeyPath,
      `${params.username}@${params.host}`,
      "--",
      "echo",
      "SSH connection established",
    ]);
    if (output.success) {
      if (output.stdout.trim() === "SSH connection established") {
        this.connected = true;
        this.em.emit("connection.established");
      } else {
        this.connected = false;
        this.em.emit("error", output);
      }
    } else {
      this.connected = false;
      this.em.emit("error", output);
    }
  }
  async execute(command: string[]) {
    const output = await Command.Execute(this.cli, [
      // SSH connection options
      "-oStrictHostKeyChecking=no",
      "-oUserKnownHostsFile=/dev/null",
      "-i",
      this.params.privateKeyPath,
      `${this.params.username}@${this.params.host}`,
      "--",
      ...command,
    ]);
    return output;
  }
  async startTunnel(config: {
    localAddress: string;
    remoteAddress: string;
    onStatusCheck: (status: any) => void;
    onStopTunnel: () => void;
  }): Promise<EventEmitter> {
    const remoteAddress = config.remoteAddress.replace("unix://", "").replace("UNIX://", "");
    const sshConnection = `${this.params.username}@${this.params.host}:${this.params.port || 22}`;
    let spawnCLI = this.cli;
    let spawnArgs = [
      "-oStrictHostKeyChecking=no",
      "-oUserKnownHostsFile=/dev/null",
      "-i",
      this.params.privateKeyPath,
      "-NL",
      //"-L",
      `${config.localAddress}:${remoteAddress}`,
      `${sshConnection}`,
    ];
    if (this.osType === OperatingSystem.Windows) {
      // Relay using custom ssh client that tunnels unix socket over a named pipe
      spawnCLI = this.relayCLI;
      spawnArgs = [
        // Relay connection options
        "--named-pipe",
        `npipe://${config.localAddress.replaceAll("\\", "/")}`,
        "--ssh-connection",
        `ssh://${sshConnection}${remoteAddress}`,
        "--ssh-timeout",
        "15",
        "--identity-path",
        this.params.privateKeyPath,
      ];
    }
    console.debug("Starting SSH tunnel", {
      osType: this.osType,
      spawnCLI,
      relayCLI: this.relayCLI,
      spawnArgs,
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
      console.debug("Starting SSH tunnel background service", config);
      return Command.ExecuteAsBackgroundService(spawnCLI, spawnArgs, {
        onStatusCheck: ({ retries, maxRetries }) => {
          console.debug("Checked SSH tunnel status", retries, maxRetries);
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
            console.debug("Checking SSH tunnel status", config);
            const response = await driver.request({
              method: "GET",
              url: "/_ping",
              socketPath: config.localAddress,
            });
            return response.status === 200;
          } catch (error) {
            console.debug("SSH tunnel status check failed", error);
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
            console.warn("SSH client tunnel started", { process, child });
            resolved = true;
            resolve(client);
          });
        })
        .catch((error: any) => {
          console.error("SSH client tunnel start - failed", error.message);
          if (!resolved) reject(error);
          resolved = true;
        });
    });
  }
  stopTunnel() {
    console.warn("Stopping SSH client tunnel");
    if (this.onStopTunnel) {
      this.onStopTunnel();
    }
  }
  close() {
    console.debug("Closing SSH connection");
    this.stopTunnel();
    const child = this.nativeApiStarterProcessChild;
    if (child) {
      console.warn("Terminating SSH client tunnel child process");
      try {
        child.kill();
        this.nativeApiStarterProcessChild = null;
        console.warn("SSH client tunnel stopped", {
          process: this.nativeApiStarterProcess,
          child,
        });
      } catch (error: any) {
        console.warn("SSH client tunnel stop - failed", error.message);
      }
    } else {
      console.debug("No SSH client tunnel found - nothing to stop");
    }
  }
}
