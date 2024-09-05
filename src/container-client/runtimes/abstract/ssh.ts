import { ApiConnection, ApiStartOptions, AvailabilityCheck, CommandExecutionResult, ControllerScope, EngineConnectorSettings, RunnerStopperOptions } from "@/env/Types";
import { SSH_PROGRAM } from "../../connection";
import { getAvailableSSHConnections } from "../../shared";
import { AbstractClientEngine } from "../abstract/base";

export abstract class AbstractClientEngineSSH extends AbstractClientEngine {
  public CONTROLLER: string = SSH_PROGRAM;

  abstract getApiConnection(scope?: string): Promise<ApiConnection>;

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
  async getControllerScopes() {
    const settings = await this.getSettings();
    const available = await this.isEngineAvailable();
    const controllerPath = settings.controller?.path || settings.controller?.name || "";
    const canListScopes = available.success && controllerPath;
    const items = canListScopes ? await getAvailableSSHConnections() : [];
    return items;
  }

  // SSH specific
  protected _connection: any;
  async startSSHConnection(host: SSHHost): Promise<boolean> {
    this._connection = await Command.StartSSHConnection(host);
    return this._connection && this._connection.connected;
  }

  async stopSSHConnection(host: SSHHost): Promise<boolean> {
    console.error("Method not implemented.");
    return false;
  }
  async runScopeCommand(program: string, args: string[], scope: string): Promise<CommandExecutionResult> {
    throw new Error("Run scope command is not yet implemented");
  }
}
