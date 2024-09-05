import { isEmpty } from "lodash-es";

import {
  ApiConnection,
  ApiStartOptions,
  ContainerEngine,
  ContainerRuntime,
  ControllerScope,
  EngineConnectorSettings,
  OperatingSystem,
  PodmanMachineInspect,
  RunnerStopperOptions
} from "@/env/Types";
import { getWindowsPipePath } from "@/platform";
import { userConfiguration } from "../../config";
import { PODMAN_PROGRAM } from "../../connection";
import { PodmanAbstractClientEngine } from "./base";

const PODMAN_API_SOCKET = `podman-desktop-companion-${PODMAN_PROGRAM}-rest-api.sock`;

export class PodmanClientEngineVirtualizedVendor extends PodmanAbstractClientEngine {
  static ENGINE = ContainerEngine.PODMAN_VIRTUALIZED_VENDOR;
  ENGINE = ContainerEngine.PODMAN_VIRTUALIZED_VENDOR;
  PROGRAM = PODMAN_PROGRAM;
  RUNTIME = ContainerRuntime.PODMAN;

  constructor(osType: OperatingSystem) {
    super(osType);
  }

  static async create(id: string, osType: OperatingSystem) {
    const instance = new PodmanClientEngineVirtualizedVendor(osType);
    instance.id = id;
    await instance.setup();
    return instance;
  }

  async getApiConnection(): Promise<ApiConnection> {
    let relay: string | undefined;
    const settings = await this.getSettings();
    const scope = settings.controller?.scope;
    if (isEmpty(scope)) {
      this.logger.error(this.id, "Unable to get api connection - no machine");
      return {
        uri: "",
        relay: undefined
      };
    }
    const NATIVE_PODMAN_SOCKET_PATH = (await Platform.isFlatpak())
      ? await Path.join("/tmp", PODMAN_API_SOCKET)
      : await Path.join(await userConfiguration.getStoragePath(), PODMAN_API_SOCKET);
    let uri = NATIVE_PODMAN_SOCKET_PATH;
    if (this.osType === OperatingSystem.Windows) {
      uri = getWindowsPipePath(scope!);
    } else {
      const homeDir = await Platform.getHomeDir();
      uri = await Path.join(homeDir, ".local/share/containers/podman/machine/podman.sock");
      if (scope) {
        const machineSockPath = await Path.join(homeDir, ".local/share/containers/podman/machine", scope, "podman.sock");
        if (await FS.isFilePresent(machineSockPath)) {
          uri = machineSockPath;
        }
      }
    }
    // Inspect machine system info for relay path
    try {
      const systemInfo = await this.getSystemInfo();
      relay = systemInfo?.host?.remoteSocket?.path || relay;
    } catch (error: any) {
      this.logger.error(this.id, "Unable to inspect machine", error);
    }
    // Inspect machine for connection details - named pipe or unix socket
    try {
      const inspectResult = await this.getPodmanMachineInspect();
      uri = inspectResult?.ConnectionInfo?.PodmanSocket?.Path || inspectResult?.ConnectionInfo?.PodmanPipe?.Path || uri;
    } catch (error: any) {
      this.logger.error(this.id, "Unable to inspect machine", error);
    }
    return {
      uri,
      relay
    };
  }

  async getPodmanMachineInspect() {
    const settings = await this.getSettings();
    let inspect: PodmanMachineInspect | undefined;
    const controllerPath = settings.controller?.path || settings.controller?.name;
    if (!controllerPath) {
      this.logger.error(this.id, "Unable to inspect - no program");
      return inspect;
    }
    const machineName = this.settings.controller?.scope;
    if (!machineName) {
      this.logger.error(this.id, "Unable to inspect - no machine");
      return inspect;
    }
    try {
      const command = ["machine", "inspect", machineName];
      const result: any = await this.runHostCommand(controllerPath, command);
      if (!result.success) {
        this.logger.error(this.id, "Unable to inspect", result);
        return inspect;
      }
      try {
        const items: PodmanMachineInspect[] = JSON.parse(result.stdout || "[]");
        const targetMachine = items.find((it) => it.Name === machineName);
        return targetMachine;
      } catch (error: any) {
        this.logger.error(this.id, "Unable to inspect", error, result);
      }
    } catch (error: any) {
      this.logger.error(this.id, "Unable to inspect - execution error", error.message, error.stack);
    }
    return inspect;
  }

  async getControllerScopes(customFormat?: string) {
    return await this.getPodmanMachines(customFormat);
  }

  // Runtime
  async startApi(customSettings?: EngineConnectorSettings, opts?: ApiStartOptions) {
    const running = await this.isApiRunning();
    if (running.success) {
      this.logger.debug(this.id, "API is already running");
      return true;
    }
    const settings = customSettings || (await this.getSettings());
    if (!settings?.controller?.scope) {
      this.logger.error(this.id, "API cannot start - controller scope is not available");
      return false;
    }
    // TODO: Safe to stop first before starting ?
    const controllerPath = settings.controller?.path || settings.controller?.name;
    const started = await this.runner.startApi(opts, {
      path: controllerPath,
      args: ["machine", "start", settings.controller.scope]
    });
    this.apiStarted = started;
    this.logger.debug(this.id, "Start API complete", started);
    return started;
  }
  async stopApi(customSettings?: EngineConnectorSettings, opts?: RunnerStopperOptions) {
    if (!this.apiStarted) {
      this.logger.debug(this.id, "Stopping API - skip(not started here)");
      return false;
    }
    this.logger.debug(this.id, "Stopping API - begin");
    const settings = await this.getSettings();
    let args: string[] = opts?.args || [];
    if (!opts?.args) {
      if (!settings.controller?.scope) {
        this.logger.error(this.id, "Stopping API - scope is not set (no custom stop args)");
        return false;
      } else {
        args = ["machine", "stop", settings.controller?.scope];
      }
    }
    const controllerPath = settings.controller?.path || settings.controller?.name;
    return await this.runner.stopApi(customSettings, {
      path: controllerPath,
      args
    });
  }
  async startScope(scope: ControllerScope): Promise<boolean> {
    return await this.startPodmanMachine(scope.Name);
  }
  async stopScope(scope: ControllerScope): Promise<boolean> {
    return await this.stopPodmanMachine(scope.Name);
  }
  async startScopeByName(name: string): Promise<boolean> {
    return await this.startPodmanMachine(name);
  }
  async stopScopeByName(name: string): Promise<boolean> {
    return await this.stopPodmanMachine(name);
  }
  // Availability
  async isEngineAvailable() {
    const result = { success: true, details: "Engine is available" };
    return result;
  }
  isScoped() {
    return true;
  }
  async runScopeCommand(program: string, args: string[], scope: string) {
    const { controller } = await this.getSettings();
    let command: string[] = [];
    if (!scope) {
      throw new Error("Unable to build scoped command - scope is not set");
    }
    command = ["machine", "ssh", scope, "-o", "LogLevel=ERROR"];
    if (program) {
      command.push(program);
    }
    if (args) {
      command.push(...args);
    }
    const hostLauncher = controller?.path || controller?.name || "";
    const hostArgs = [...command];
    return await this.runHostCommand(hostLauncher, hostArgs);
  }
}
