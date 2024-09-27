import { isEmpty } from "lodash-es";

import { ApiConnection, ApiStartOptions, Connection, ContainerEngine, ContainerEngineHost, EngineConnectorSettings, OperatingSystem } from "@/env/Types";
import { getWindowsPipePath } from "@/platform";
import { PODMAN_PROGRAM, WSL_PROGRAM } from "../../connection";
import { AbstractContainerEngineHostClientVirtualizedWSL } from "../abstract/wsl";
import { PodmanContainerEngineHostClientCommon } from "./base";

export class PodmanContainerEngineHostClientVirtualizedWSL extends AbstractContainerEngineHostClientVirtualizedWSL implements PodmanContainerEngineHostClientCommon {
  static HOST = ContainerEngineHost.PODMAN_VIRTUALIZED_WSL;
  HOST = ContainerEngineHost.PODMAN_VIRTUALIZED_WSL;
  PROGRAM = PODMAN_PROGRAM;
  CONTROLLER = WSL_PROGRAM;
  ENGINE = ContainerEngine.PODMAN;

  static async create(id: string, osType: OperatingSystem) {
    const instance = new PodmanContainerEngineHostClientVirtualizedWSL(osType);
    instance.id = id;
    await instance.setup();
    return instance;
  }

  async getApiConnection(connection?: Connection, customSettings?: EngineConnectorSettings): Promise<ApiConnection> {
    const settings = customSettings || (await this.getSettings());
    const scope = settings.controller?.scope || "";
    if (!scope) {
      this.logger.error(this.id, "getApiConnection requires a scope");
      return {
        uri: "",
        relay: ""
      };
    }
    const uri = scope.startsWith("podman-machine") ? getWindowsPipePath(scope) : "";
    let relay = "";
    // Get environment variable inside the scope
    try {
      const info = await this.getSystemInfo(connection, undefined, settings);
      relay = info?.host?.remoteSocket?.path || "";
    } catch (error: any) {
      this.logger.warn(this.id, "Unable to get system info", error);
    }
    // Inspect machine system info for relay path
    return {
      uri,
      relay
    };
  }

  // Engine
  async startApi(customSettings?: EngineConnectorSettings, opts?: ApiStartOptions) {
    const running = await this.isApiRunning();
    if (running.success) {
      this.logger.debug(this.id, "<< Starting API skipped - API is already running");
      return true;
    }
    this.logger.warn(this.id, ">> Starting API - starting system service");
    const settings = customSettings || (await this.getSettings()) || {};
    this.logger.debug(this.id, ">> Starting API", settings, opts);
    const args = ["system", "service", "--time=0", `unix://${settings.api.connection.relay}`, "--log-level=debug"];
    const { program, controller } = settings;
    let launcherPath = "";
    let launcherArgs = [...args];
    const scope = settings?.controller?.scope || "";
    if (this.isScoped()) {
      launcherPath = controller?.path || controller?.name || "";
      const programPath = program.path || program.name;
      launcherArgs = [programPath, ...args];
      try {
        // Bug on WSL - podman is unable to create the base directory for the unix socket
        if (settings.api.connection.relay) {
          const baseDir = await Path.dirname(settings.api.connection.relay);
          this.logger.error("Ensuring relay base directory", settings.api.connection.relay);
          const created = await this.runScopeCommand("mkdir", ["-p", baseDir], scope || "");
          if (created.success) {
            this.logger.debug(this.id, "Base directory created", baseDir);
          } else {
            this.logger.warn("Base directory not created", baseDir, { result: created });
          }
        } else {
          this.logger.warn("No relay path - base dir not ensured");
        }
      } catch (error: any) {
        this.logger.warn(this.id, "Unable to create base directory", settings.api.connection.relay, error);
      }
    } else {
      launcherPath = program.path || program.name;
    }
    this.logger.debug(this.id, ">> Starting API", settings, opts, { launcherPath, launcherArgs });
    const started: any = await this.runner.startApi(opts, {
      path: launcherPath,
      args: ["--distribution", scope, "--exec", "bash", "-l", "-c", "$@", "--"].concat(launcherArgs)
    });
    this.apiStarted = started;
    this.logger.debug(this.id, "<< Starting API completed", started);
    return started;
  }

  isScoped() {
    return true;
  }

  async getPodLogs(id?: any, tail?: any) {
    this.logger.debug("Retrieving pod logs", id, tail);
    const { program, controller } = await this.getSettings();
    if (isEmpty(program.path)) {
      this.logger.error("Unable to create machine - program path is empty", program);
      throw new Error("Program path is empty");
    }
    const args = ["pod", "logs"];
    if (typeof tail !== "undefined") {
      args.push(`--tail=${tail}`);
    }
    args.push("-f", id);
    let result;
    if (this.isScoped()) {
      result = await this.runScopeCommand(program.path || "", args, controller?.scope || "");
    } else {
      result = await this.runHostCommand(program.path || "", args);
    }
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
