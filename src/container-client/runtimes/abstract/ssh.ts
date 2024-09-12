import { isEmpty } from "lodash-es";

import { systemNotifier } from "@/container-client/notifier";
import { ApiConnection, ApiStartOptions, AvailabilityCheck, CommandExecutionResult, Connection, ControllerScope, EngineConnectorSettings, RunnerStopperOptions } from "@/env/Types";
import { ContainerClient, createApplicationApiDriver } from "../../Api.clients";
import { SSH_PROGRAM } from "../../connection";
import { ISSHClient } from "../../services";
import { getAvailableSSHConnections } from "../../shared";
import { AbstractContainerEngineHostClient } from "../abstract/base";

export abstract class AbstractContainerEngineHostClientSSH extends AbstractContainerEngineHostClient {
  public CONTROLLER: string = SSH_PROGRAM;
  protected _connection: ISSHClient | undefined;

  protected connectionsTracker: { [key: string]: ISSHClient } = {};

  abstract getApiConnection(connection?: Connection, customSettings?: EngineConnectorSettings): Promise<ApiConnection>;

  async getContainerApiClient() {
    if (!this.containerApiClient) {
      const connection: Connection = {
        name: "Current",
        label: "Current",
        settings: this.settings,
        engine: this.ENGINE,
        host: this.HOST,
        id: this.id
      };
      this.containerApiClient = new ContainerClient(
        connection,
        createApplicationApiDriver(connection, {
          getSSHConnection: async () => {
            systemNotifier.transmit("host.availability", {
              trace: "Starting SSH connection"
            });
            // console
            const scopes = await this.getControllerScopes();
            const scope = scopes.find((s) => s.Name === this.settings.controller?.scope);
            const connected = await this.startSSHConnection(scope as SSHHost);
            if (connected) {
              console.debug("Returning connection", this, scope);
              systemNotifier.transmit("host.availability", {
                trace: "SSH connection has been established"
              });
              return this._connection;
            } else {
              systemNotifier.transmit("host.availability", {
                trace: "SSH connection has failed"
              });
            }
            console.error("SSH connection is not established", this, scope, connected);
            throw new Error("SSH connection is not established");
          }
        })
      );
    }
    return this.containerApiClient;
  }

  // Engine
  async startApi(customSettings?: EngineConnectorSettings, opts?: ApiStartOptions) {
    this.logger.debug(this.id, "Start api skipped - not required");
    return true;
  }
  async stopApi(customSettings?: EngineConnectorSettings, opts?: RunnerStopperOptions) {
    const settings = customSettings || (await this.getSettings());
    // Stop services
    try {
      await Command.StopConnectionServices(this.id, settings);
    } catch (e: any) {
      this.logger.error(this.id, "Stop api - failed to stop connection services", e);
    }
    // Stop scope - LIMA -instance
    try {
      const scope = settings?.controller?.scope || "";
      await this.stopScopeByName(scope);
    } catch (e: any) {
      this.logger.error(this.id, "Stop api - failed to stop connection scope", e);
    }
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
  async getControllerScopes(customSettings?: EngineConnectorSettings, skipAvailabilityCheck?: boolean) {
    const settings = customSettings || (await this.getSettings());
    const available = await this.isEngineAvailable();
    const controllerPath = settings.controller?.path || settings.controller?.name || "";
    const canListScopes = available.success && controllerPath;
    let items = canListScopes ? await getAvailableSSHConnections() : [];
    items = items.map((it) => {
      it.Usable = this.connectionsTracker[it.Name]?.isConnected() ?? false;
      it.Connected = it.Usable;
      return it;
    });
    return items;
  }

  async getControllerDefaultScope(customSettings?: EngineConnectorSettings): Promise<ControllerScope | undefined> {
    const scopes = await this.getControllerScopes(customSettings);
    if (scopes.length > 0) {
      if (customSettings?.controller?.scope) {
        const matchingScope = scopes.find((s) => s.Name === customSettings?.controller?.scope);
        return matchingScope;
      } else {
        this.logger.error(this.id, "Controller scope is not set", customSettings);
      }
    } else {
      this.logger.error(this.id, "No controller scopes available - no SSH connections configured", customSettings);
    }
    return undefined;
  }

  // SSH specific
  async startSSHConnection(host: SSHHost): Promise<boolean> {
    if (this._connection && this._connection.isConnected()) {
      return true;
    }
    const settings = await this.getSettings();
    const sshExecutable = settings.controller?.path || settings.controller?.name || SSH_PROGRAM;
    this._connection = await Command.StartSSHConnection(host, sshExecutable);
    if (this._connection) {
      this.connectionsTracker[host.Name] = this._connection;
      return this._connection && this._connection.isConnected();
    }
    return false;
  }

  async stopSSHConnection(host: SSHHost): Promise<boolean> {
    this.logger.debug(this.id, "Stopping SSH connection", host);
    if (this._connection) {
      this._connection.close();
      delete this.connectionsTracker[host.Name];
      this._connection = undefined;
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

  async generateKube(entityId?: any) {
    const { program, controller } = await this.getSettings();
    if (isEmpty(program.path)) {
      this.logger.error("Unable to generate kube - program path is empty", program);
      throw new Error("Unable to generate kube - program path is empty");
    }
    let result;
    if (this.isScoped()) {
      result = await this.runScopeCommand(program.path || "", ["generate", "kube", entityId], controller?.scope || "");
    } else {
      result = await this.runHostCommand(program.path || "", ["generate", "kube", entityId]);
    }
    if (!result.success) {
      this.logger.error("Unable to generate kube", entityId, result);
    }
    return result;
  }
}
