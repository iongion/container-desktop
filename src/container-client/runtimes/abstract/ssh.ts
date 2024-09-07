import { ApiConnection, ApiStartOptions, AvailabilityCheck, CommandExecutionResult, Connection, ControllerScope, EngineConnectorSettings, RunnerStopperOptions } from "@/env/Types";
import { ContainerClient, createApplicationApiDriver } from "../../Api.clients";
import { SSH_PROGRAM } from "../../connection";
import { ISSHClient } from "../../services";
import { getAvailableSSHConnections } from "../../shared";
import { AbstractClientEngine } from "../abstract/base";

export abstract class AbstractClientEngineSSH extends AbstractClientEngine {
  public CONTROLLER: string = SSH_PROGRAM;
  protected _connection!: ISSHClient;

  protected connectionsTracker: { [key: string]: any } = {};

  abstract getApiConnection(connection?: Connection, customSettings?: EngineConnectorSettings): Promise<ApiConnection>;

  getContainerApiClient() {
    if (!this.containerApiClient) {
      const connection: Connection = {
        name: "Current",
        label: "Current",
        settings: this.settings,
        runtime: this.RUNTIME,
        engine: this.ENGINE,
        id: this.id
      };
      this.containerApiClient = new ContainerClient(
        connection,
        createApplicationApiDriver(connection, {
          getSSHConnection: async () => {
            // console
            const scopes = await this.getControllerScopes();
            const scope = scopes.find((s) => s.Name === this.settings.controller?.scope);
            const connected = await this.startSSHConnection(scope as SSHHost);
            if (connected) {
              console.debug("Returning connection", this, scope);
              return this._connection;
            }
            console.error("SSH connection is not established", this, scope, connected);
            throw new Error("SSH connection is not established");
          }
        })
      );
    }
    return this.containerApiClient;
  }

  // Runtime
  async startApi(customSettings?: EngineConnectorSettings, opts?: ApiStartOptions) {
    this.logger.debug(this.id, "Start api skipped - not required");
    return true;
  }
  async stopApi(customSettings?: EngineConnectorSettings, opts?: RunnerStopperOptions) {
    this.logger.debug(this.id, "Stop api skipped - not required");
    return true;
  }

  async startScope(scope: ControllerScope): Promise<boolean> {
    const check = await this.startSSHConnection(scope as SSHHost);
    return check;
  }
  async stopScope(scope: ControllerScope): Promise<boolean> {
    const check = await this.stopSSHConnection(scope as SSHHost);
    return check;
  }
  async startScopeByName(name: string): Promise<boolean> {
    const scopes = await this.getControllerScopes();
    const scope = scopes.find((s) => s.Name === name);
    return await this.startSSHConnection(scope as SSHHost);
  }
  async stopScopeByName(name: string): Promise<boolean> {
    const scopes = await this.getControllerScopes();
    const scope = scopes.find((s) => s.Name === name);
    return await this.stopSSHConnection(scope as SSHHost);
  }
  // Availability

  async isEngineAvailable() {
    const result: AvailabilityCheck = { success: true, details: "Engine is available" };
    return result;
  }

  // Services
  async getControllerScopes(customSettings?: EngineConnectorSettings) {
    const settings = customSettings || (await this.getSettings());
    const available = await this.isEngineAvailable();
    const controllerPath = settings.controller?.path || settings.controller?.name || "";
    const canListScopes = available.success && controllerPath;
    let items = canListScopes ? await getAvailableSSHConnections() : [];
    items = items.map((it) => {
      it.Usable = this.connectionsTracker[it.Name]?.connected ?? false;
      it.Connected = it.Usable;
      return it;
    });
    return items;
  }

  // SSH specific
  async startSSHConnection(host: SSHHost): Promise<boolean> {
    if (this._connection && this._connection.isConnected()) {
      return true;
    }
    const settings = await this.getSettings();
    const sshExecutable = settings.controller?.path || settings.controller?.name || SSH_PROGRAM;
    this.connectionsTracker[host.Name] = { connected: false };
    this._connection = await Command.StartSSHConnection(host, sshExecutable);
    if (this._connection && this._connection.isConnected()) {
      this.connectionsTracker[host.Name] = { connected: true };
    }
    return this._connection && this._connection.isConnected();
  }

  async stopSSHConnection(host: SSHHost): Promise<boolean> {
    this.connectionsTracker[host.Name] = { connected: false };
    if (this._connection) {
      this._connection.close();
    }
    return true;
  }

  async runScopeCommand(program: string, args: string[], scope: string, settings?: EngineConnectorSettings): Promise<CommandExecutionResult> {
    if (!this._connection || !this._connection.isConnected()) {
      throw new Error("SSH connection is not established");
    }
    const result = await this._connection.execute([program, ...args]);
    return result;
  }
}
