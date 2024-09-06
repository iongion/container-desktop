import { CommandExecutionResult, OperatingSystem } from "@/env/Types";
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
  connect: (params: SSHClientConnection) => Promise<void>;
  execute: (command: string[]) => Promise<CommandExecutionResult>;
  startTunnel: (config: any) => Promise<any>;
  close: () => void;
}

export class SSHClient implements ISSHClient {
  protected osType: OperatingSystem;
  protected em: EventEmitter;
  protected params!: SSHClientConnection;
  protected connected: boolean = false;
  public cli: string = "";
  protected nativeApiStarterProcess: any;
  protected nativeApiStarterProcessChild: any;
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
  async connect(params: SSHClientConnection) {
    this.params = params;
    // this.em.emit("ready");
    const output = await Command.Execute(this.cli, ["-i", params.privateKeyPath, `${params.username}@${params.host}`, "--", "echo", "SSH connection established"]);
    if (output.success) {
      if (output.stdout.trim() === "SSH connection established") {
        this.connected = true;
        this.em.emit("ready");
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
  async startTunnel(config: any) {
    return new Promise((resolve, reject) => {
      let resolved = false;
      return Command.ExecuteAsBackgroundService(
        this.cli,
        [
          "-oStrictHostKeyChecking=no",
          "-oUserKnownHostsFile=/dev/null",
          "-i",
          this.params.privateKeyPath,
          "-NL",
          //"-L",
          `${config.localAddress}:${config.remoteAddress}`,
          `${this.params.username}@${this.params.host}`
        ],
        {
          checkStatus: async () => {
            try {
              const response = await Command.proxyTCPRequest(
                {
                  method: "GET",
                  url: `/_ping`
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
          client.on("error", (error: any) => {
            if (!resolved) reject(error);
            resolved = true;
          });
          client.on("ready", async ({ process, child }) => {
            this.nativeApiStarterProcess = process;
            this.nativeApiStarterProcessChild = child;
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
  close() {
    if (this.nativeApiStarterProcessChild) {
      try {
        this.nativeApiStarterProcessChild.kill("SIGTERM");
        this.nativeApiStarterProcessChild = null;
      } catch (error: any) {
        console.warn("Stopping API - failed", error.message);
      }
    } else {
      console.debug("No native starter process child found - nothing to stop");
    }
  }
}
