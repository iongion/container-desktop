import { CommandExecutionResult, OperatingSystem, SpawnedProcess } from "@/env/Types";
import EventEmitter from "eventemitter3";

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
  startTunnel: (config: { localAddress: string; remoteAddress: string; onStopTunnel: () => void }) => Promise<EventEmitter>;
  stopTunnel: () => void;
  close: () => void;
}

export class SSHClient implements ISSHClient {
  protected osType: OperatingSystem;
  protected em: EventEmitter;
  protected params!: SSHClientConnection;
  protected connected: boolean = false;
  public cli: string = "";
  protected nativeApiStarterProcess: CommandExecutionResult | null = null;
  protected nativeApiStarterProcessChild: SpawnedProcess | null = null;
  protected onStopTunnel?: () => void | null;
  constructor({ osType }: { osType: OperatingSystem }) {
    this.em = new EventEmitter();
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
    const output = await Command.Execute(this.cli, ["-i", params.privateKeyPath, `${params.username}@${params.host}`, "--", "echo", "SSH connection established"]);
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
    const output = await Command.Execute(this.cli, ["-i", this.params.privateKeyPath, `${this.params.username}@${this.params.host}`, "--", ...command]);
    return output;
  }
  async startTunnel(config: { localAddress: string; remoteAddress: string; onStopTunnel: () => void }): Promise<EventEmitter> {
    return new Promise((resolve, reject) => {
      let resolved = false;
      console.debug("Starting SSH tunnel", config);
      return Command.ExecuteAsBackgroundService(
        this.cli,
        [
          "-oStrictHostKeyChecking=no",
          "-oUserKnownHostsFile=/dev/null",
          "-i",
          this.params.privateKeyPath,
          "-NL",
          //"-L",
          `${config.localAddress}:${config.remoteAddress.replace("unix://", "").replace("UNIX://", "")}`,
          `${this.params.username}@${this.params.host}`
        ],
        {
          checkStatus: async () => {
            try {
              const response = await Command.proxyTCPRequest(
                {
                  method: "GET",
                  url: "/_ping"
                },
                config.localAddress
              );
              return response.success;
            } catch (error) {
              return false;
            }
          }
        }
      )
        .then((client) => {
          console.warn("SSH client tunnel created", client);
          client.on("error", (error: any) => {
            if (!resolved) reject(error);
            resolved = true;
          });
          client.on("ready", async ({ process, child }: { process: CommandExecutionResult; child: SpawnedProcess }) => {
            console.warn("SSH client tunnel started", { process, child });
            this.nativeApiStarterProcess = process;
            this.nativeApiStarterProcessChild = child;
            this.onStopTunnel = config.onStopTunnel;
            resolved = true;
            resolve(client);
          });
        })
        .catch((error: any) => {
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
        console.warn("SSH client tunnel stopped", { process: this.nativeApiStarterProcess, child });
      } catch (error: any) {
        console.warn("SSH client tunnel stop - failed", error.message);
      }
    } else {
      console.debug("No SSH client tunnel found - nothing to stop");
    }
  }
}
