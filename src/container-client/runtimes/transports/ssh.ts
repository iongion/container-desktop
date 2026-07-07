// runtimes/transports/ssh.ts — SSHTransport: a remote engine reached over an SSH connection.
//
// Lifts runtimes/abstract/ssh.ts. The SSH connection + tracker are per-host transport state. getApiDriver is
// special: it injects the getSSHConnection establishment hook into createApplicationApiDriver, so the raw
// driver can lazily bring up the SSH tunnel on first request (preserved verbatim).

import type { AxiosInstance } from "axios";

import { isWindowsProgramPath } from "@/container-client/detector";
import { systemNotifier } from "@/container-client/notifier";
import type { ISSHClient } from "@/container-client/services";
import { getAvailableSSHConnections } from "@/container-client/shared";
import {
  type CommandExecutionResult,
  type ControllerScope,
  type EngineConnectorSettings,
  type HostExecOptions,
  OperatingSystem,
  type ServiceOpts,
  StartupStatus,
} from "@/env/Types";
import { getWindowsPipePath } from "@/platform";
import { createApplicationApiDriver } from "../../Api.clients";
import type { HostContext, Transport } from "../composition";
import { buildCurrentConnection } from "./shared";

// A Windows engine path with spaces ("C:\Program Files\...\docker.exe") reaches the remote as argv joined by
// spaces, so the cmd.exe default shell would try to run `C:\Program`. Quote argv[0] so the whole path is the
// command. POSIX program names never match isWindowsProgramPath, so Linux/macOS remotes are unaffected; the
// already-quoted guard keeps callers that pre-quote (e.g. version detection) from being double-quoted.
export function quoteScopeProgram(program: string): string {
  if (program.includes(" ") && !program.startsWith('"') && isWindowsProgramPath(program)) {
    return `"${program}"`;
  }
  return program;
}

export class SSHTransport implements Transport {
  public readonly isScoped = true;

  protected _connection: ISSHClient | undefined;
  protected connectionsTracker: { [key: string]: ISSHClient } = {};

  shouldKeepStartedScopeRunning() {
    return false;
  }

  async runScopeCommand(
    _host: HostContext,
    program: string,
    args: string[],
    _scope?: string,
    _settings?: EngineConnectorSettings,
    execOpts?: HostExecOptions,
  ): Promise<CommandExecutionResult> {
    if (!this._connection?.isConnected()) {
      throw new Error("SSH connection is not established");
    }
    // OpenSSH forwards our local process's stdin to the remote program, so `execOpts.input` (a secret piped for
    // `login --password-stdin`) reaches the remote engine without ever appearing in the remote argv.
    const result = await this._connection.execute([quoteScopeProgram(program), ...args], execOpts);
    return result;
  }

  async runScopeCommandStreaming(_host: HostContext, program: string, args: string[]): Promise<StreamHandle> {
    if (!this._connection?.isConnected()) {
      throw new Error("SSH connection is not established");
    }
    return await this._connection.executeStreaming([quoteScopeProgram(program), ...args]);
  }

  async resolveGuestPath(_host: HostContext, localPath: string): Promise<string> {
    // Remote host: the user provides a path that already lives on the remote — no local↔remote translation.
    return localPath;
  }

  async listScopes(host: HostContext, settings?: EngineConnectorSettings): Promise<ControllerScope[]> {
    const userSettings = settings || (await host.getSettings());
    const available = await host.isEngineAvailable();
    const controllerPath = userSettings.controller?.path || userSettings.controller?.name || "";
    const canListScopes = available.success && controllerPath;
    let items = canListScopes ? await getAvailableSSHConnections() : [];
    items = items.map((it) => {
      it.Usable = this.connectionsTracker[it.Name]?.isConnected() ?? false;
      it.Connected = it.Usable;
      return it;
    });
    return items;
  }

  async getControllerDefaultScope(
    host: HostContext,
    customSettings?: EngineConnectorSettings,
  ): Promise<ControllerScope | undefined> {
    const scopes = await host.getControllerScopes(customSettings);
    if (scopes.length > 0) {
      if (customSettings?.controller?.scope) {
        const matchingScope = scopes.find((s) => s.Name === customSettings?.controller?.scope);
        return matchingScope;
      }
      host.logger.error(host.id, "Controller scope is not set", customSettings);
    } else {
      host.logger.error(host.id, "No controller scopes available - no SSH connections configured", customSettings);
    }
    return undefined;
  }

  async startScope(host: HostContext, scope: ControllerScope): Promise<StartupStatus> {
    return await this.startSSHConnection(scope as SSHHost, {
      onStatusCheck: (status) => {
        host.logger.debug(host.id, "SSH connection status check", status);
      },
    });
  }

  async stopScope(host: HostContext, scope: ControllerScope): Promise<boolean> {
    return await this.stopSSHConnection(host, scope as SSHHost);
  }

  async startScopeByName(host: HostContext, name: string): Promise<StartupStatus> {
    const scopes = await host.getControllerScopes();
    const scope = scopes.find((s) => s.Name === name);
    return await this.startSSHConnection(scope as SSHHost, {
      onStatusCheck: (status) => {
        host.logger.debug(host.id, "SSH connection status check", status);
      },
    });
  }

  async stopScopeByName(host: HostContext, name: string): Promise<boolean> {
    const scopes = await host.getControllerScopes();
    const scope = scopes.find((s) => s.Name === name);
    return await this.stopSSHConnection(host, scope as SSHHost);
  }

  async resolveScopeURI(host: HostContext): Promise<string> {
    if (host.osType === OperatingSystem.Windows) {
      return getWindowsPipePath(host.id);
    }
    return "";
  }

  async startApi(host: HostContext): Promise<boolean> {
    host.logger.debug(host.id, "Start api skipped - not required");
    return true;
  }

  async stopApi(host: HostContext, customSettings?: EngineConnectorSettings): Promise<boolean> {
    const settings = customSettings || (await host.getSettings());
    // Stop services
    try {
      await Command.StopConnectionServices(host.id, settings);
    } catch (e: any) {
      host.logger.error(host.id, "Stop api - failed to stop connection services", e);
    }
    // Stop scope - SSH connection
    try {
      const scope = settings?.controller?.scope || "";
      await host.stopScopeByName(scope);
    } catch (e: any) {
      host.logger.error(host.id, "Stop api - failed to stop connection scope", e);
    }
    return true;
  }

  async getApiDriver(host: HostContext, settings: EngineConnectorSettings): Promise<AxiosInstance> {
    const connection = buildCurrentConnection(host, settings);
    return createApplicationApiDriver(connection, {
      getSSHConnection: async () => {
        systemNotifier.transmit("engine.availability", {
          trace: "Starting SSH connection",
        });
        const scopes = await host.getControllerScopes();
        const currentSettings = await host.getSettings();
        const scope = scopes.find((s) => s.Name === currentSettings.controller?.scope);
        // Fixed (review): startSSHConnection returns a StartupStatus string; the old `if (connected)` treated
        // ERROR ("error", a truthy non-empty string) as success. Only RUNNING/STARTED is an established connection.
        const status = await this.startSSHConnection(scope as SSHHost, {
          onStatusCheck: (info) => {
            systemNotifier.transmit("engine.availability", {
              trace: `API status checking - retry ${info.retries + 1} of ${info.maxRetries}`,
            });
          },
        });
        if (status === StartupStatus.RUNNING || status === StartupStatus.STARTED) {
          host.logger.debug(host.id, "Returning SSH connection", { scope: scope?.Name });
          systemNotifier.transmit("engine.availability", {
            trace: "SSH connection has been established",
          });
          return this._connection;
        }
        systemNotifier.transmit("engine.availability", {
          trace: "SSH connection has failed",
        });
        host.logger.error(host.id, "SSH connection is not established", { scope: scope?.Name, status });
        throw new Error("SSH connection is not established");
      },
    });
  }

  // SSH specific
  protected async startSSHConnection(sshHost: SSHHost, opts?: Partial<ServiceOpts>): Promise<StartupStatus> {
    if (this._connection?.isConnected()) {
      return StartupStatus.RUNNING;
    }
    this._connection = await Command.StartSSHConnection(sshHost, opts);
    if (this._connection) {
      this.connectionsTracker[sshHost.Name] = this._connection;
      const running = this._connection?.isConnected();
      return running ? StartupStatus.RUNNING : StartupStatus.ERROR;
    }
    return StartupStatus.ERROR;
  }

  protected async stopSSHConnection(host: HostContext, sshHost: SSHHost): Promise<boolean> {
    host.logger.debug(host.id, "Stopping SSH connection", sshHost);
    if (this._connection) {
      this._connection.close();
      delete this.connectionsTracker[sshHost.Name];
      this._connection = undefined;
    }
    return true;
  }
}
