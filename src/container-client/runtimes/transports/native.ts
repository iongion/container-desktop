// runtimes/transports/native.ts — NativeTransport: the host runs the engine directly (no scope).
//
// Every Transport method is present; the scope operations are no-ops (maximize symmetry). Lifts
// podman/native.ts + docker/native.ts + the base.ts stopApi. The engine-specific service command comes from
// host.dialect.buildServiceArgs (Podman → service args, Docker → null = "start the host manually").

import type { AxiosInstance } from "axios";

import {
  type ApiStartOptions,
  type CommandExecutionResult,
  type ControllerScope,
  type EngineConnectorSettings,
  type RunnerStopperOptions,
  StartupStatus,
} from "@/env/Types";
import type { HostContext, Transport } from "../composition";
import { createPlainApiDriver } from "./shared";

export class NativeTransport implements Transport {
  public readonly isScoped = false;

  shouldKeepStartedScopeRunning() {
    return true;
  }

  async runScopeCommand(): Promise<CommandExecutionResult> {
    throw new Error("Scope is not supported in native mode");
  }

  async listScopes(host: HostContext, settings?: EngineConnectorSettings): Promise<ControllerScope[]> {
    // podman-native lists its machines; docker-native has no scopes (gated by the machines capability).
    return host.capabilities.extensions.machines ? await host.getPodmanMachines(undefined, settings) : [];
  }

  async getControllerDefaultScope(): Promise<ControllerScope | undefined> {
    // Native hosts have no controller scope (was a throw in the leaves - a clean no-op here).
    return undefined;
  }

  async startScope(host: HostContext): Promise<StartupStatus> {
    host.logger.warn("Scope is not supported in native mode");
    return StartupStatus.ERROR;
  }

  async stopScope(host: HostContext): Promise<boolean> {
    host.logger.warn("Scope is not supported in native mode");
    return false;
  }

  async startScopeByName(host: HostContext): Promise<StartupStatus> {
    host.logger.warn("Scope is not supported in native mode");
    return StartupStatus.ERROR;
  }

  async stopScopeByName(host: HostContext): Promise<boolean> {
    host.logger.warn("Scope is not supported in native mode");
    return false;
  }

  async resolveScopeURI(): Promise<string> {
    return "";
  }

  async startApi(
    host: HostContext,
    customSettings?: EngineConnectorSettings,
    opts?: ApiStartOptions,
  ): Promise<boolean> {
    const running = await host.isApiRunning();
    const logLevel = opts?.logLevel || "debug";
    host.logger.debug(host.id, "Starting API", { logLevel });
    if (running.success) {
      host.logger.debug(host.id, "API is already running");
      return true;
    }
    const settings = customSettings || (await host.getSettings());
    const programPath = settings.program.path || settings.program.name || "";
    const socketPath = `${settings.api.connection.uri || ""}`.replace("unix://", "");
    const serviceArgs = host.dialect.buildServiceArgs(socketPath, logLevel);
    if (!serviceArgs) {
      // Docker native: there is no managed service - the host must be started manually.
      host.logger.error(host.id, "Start api failed - must start host manually");
      return false;
    }
    if (socketPath) {
      const baseDir = await Path.dirname(socketPath);
      // CHANGE: I don't know why podman does not create the base-dir of the listening socket
      if (await Platform.isFlatpak()) {
        if (baseDir.startsWith("/run/user")) {
          const hostBaseDir = await Path.join("/var", baseDir);
          host.logger.debug(host.id, "(flatpak) Ensuring socket base dir exists in host", hostBaseDir);
          await FS.mkdir(hostBaseDir, { recursive: true });
        } else {
          const hostBaseDir = await Path.join("/var/run/host", baseDir);
          host.logger.debug(host.id, "(flatpak) Ensuring socket base dir exists in host", hostBaseDir);
          await FS.mkdir(hostBaseDir, { recursive: true });
        }
      }
      host.logger.debug(host.id, "Ensuring socket base dir exists", baseDir);
      const baseExists = await FS.isFilePresent(baseDir);
      if (!baseExists) {
        host.logger.debug(host.id, "Creating socket base dir", baseDir);
        await FS.mkdir(baseDir, { recursive: true });
      }
    }
    const started = await host.runner.startApi(opts, {
      path: programPath,
      args: serviceArgs,
    });
    host.logger.debug("Start API complete", started);
    return started;
  }

  async stopApi(
    host: HostContext,
    customSettings?: EngineConnectorSettings,
    opts?: RunnerStopperOptions,
  ): Promise<boolean> {
    host.logger.debug("Stopping API - begin");
    const settings = customSettings || (await host.getSettings());
    await Command.StopConnectionServices(host.id, settings);
    if (!host.runner) {
      host.logger.warn("Stopping API - skip(no runner)");
      return true;
    }
    if (!host.runner.isStarted()) {
      host.logger.debug("Stopping API - skip(not started here)");
      return false;
    }
    const stopped = await host.runner.stopApi(settings, opts);
    host.logger.debug("Stopping API - complete", { stopped });
    return stopped;
  }

  async getApiDriver(host: HostContext, settings: EngineConnectorSettings): Promise<AxiosInstance> {
    return createPlainApiDriver(host, settings);
  }
}
