import { isEmpty } from "lodash-es";

import { ApiConnection, ApiStartOptions, ContainerEngine, ContainerRuntime, EngineConnectorSettings } from "@/env/Types";
import { getWindowsPipePath, OperatingSystem } from "@/platform";
import { PODMAN_PROGRAM } from "../../connection";
import { AbstractClientEngineVirtualizedWSL } from "../abstract/wsl";
import { PodmanClientEngineCommon } from "./base";

export class PodmanClientEngineVirtualizedWSL extends AbstractClientEngineVirtualizedWSL implements PodmanClientEngineCommon {
  static ENGINE = ContainerEngine.PODMAN_VIRTUALIZED_WSL;
  ENGINE = ContainerEngine.PODMAN_VIRTUALIZED_WSL;
  PROGRAM = PODMAN_PROGRAM;
  RUNTIME = ContainerRuntime.PODMAN;

  static async create(id: string, osType: OperatingSystem) {
    const instance = new PodmanClientEngineVirtualizedWSL(osType);
    instance.id = id;
    await instance.setup();
    return instance;
  }

  async getApiConnection(): Promise<ApiConnection> {
    const settings = await this.getSettings();
    const scope = settings.controller?.scope || "";
    if (!scope) {
      this.logger.error(this.id, "getApiConnection requires a scope");
      return {
        uri: "",
        relay: undefined
      };
    }
    // Get environment variable inside the scope
    const userDataDir = await this.getConnectionDataDir();
    const relay = `${userDataDir}/podman-desktop-companion-wsl-relay.sock`;
    const uri = getWindowsPipePath(scope.startsWith("podman-machine") ? scope : `${this.RUNTIME}-${scope}`);
    // Inspect machine system info for relay path
    return {
      uri,
      relay
    };
  }
  // Runtime
  async startApi(customSettings?: EngineConnectorSettings, opts?: ApiStartOptions) {
    const running = await this.isApiRunning();
    if (running.success) {
      this.logger.debug(this.id, "<< Starting API skipped - API is already running");
      return true;
    }
    this.logger.warn(this.id, ">> Starting API - starting system service");
    const settings = customSettings || (await this.getSettings());
    this.logger.debug(this.id, ">> Starting API", settings, opts);
    const args = ["system", "service", "--time=0", `unix://${settings.api.connection.relay}`, "--log-level=debug"];
    const { program, controller } = settings;
    let launcherPath = "";
    let launcherArgs = [...args];
    if (this.isScoped()) {
      launcherPath = controller?.path || controller?.name || "";
      const programPath = program.path || program.name;
      launcherArgs = [programPath, ...args];
    } else {
      launcherPath = program.path || program.name;
    }
    const started: any = await this.runner.startApi(opts, {
      path: launcherPath,
      args: launcherArgs
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
