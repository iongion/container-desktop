import { isEmpty } from "lodash-es";

import { findProgramPath } from "@/container-client/detector";
import { AbstractContainerEngineHostClient, ContainerEngineHostClient } from "@/container-client/runtimes/abstract";
import {
  CommandExecutionResult,
  Connection,
  ContainerEngineHost,
  CreateMachineOptions,
  EngineConnectorSettings,
  PodmanMachineInspect,
  StartupStatus,
  SystemInfo
} from "@/env/Types";
import { getAvailablePodmanMachines } from "../../shared";

export interface PodmanContainerEngineHostClientCommon extends ContainerEngineHostClient {
  getPodLogs: (id?: any, tail?: any) => Promise<CommandExecutionResult>;
  generateKube: (id?: any, tail?: any) => Promise<CommandExecutionResult>;
}

export abstract class PodmanAbstractContainerEngineHostClient extends AbstractContainerEngineHostClient implements PodmanContainerEngineHostClientCommon {
  async getPodmanMachineInspect(name?: string, customSettings?: EngineConnectorSettings) {
    const settings = customSettings || (await this.getSettings());
    let inspect: PodmanMachineInspect | undefined;
    const controllerPath = await this.getControllerLauncherPath();
    if (!controllerPath) {
      this.logger.error(this.id, "Unable to inspect - no program");
      return inspect;
    }
    const machineName = name || settings.controller?.scope;
    if (!machineName) {
      this.logger.error(this.id, "Unable to inspect - no machine");
      return inspect;
    }
    try {
      const command = ["machine", "inspect", machineName];
      const result: any = await this.runHostCommand(controllerPath, command, settings);
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

  async getPodmanMachines(customFormat?: string, customSettings?: EngineConnectorSettings) {
    this.logger.debug(this.id, "getMachines with program");
    const settings = customSettings || (await this.getSettings());
    const engineAvailabilityTest = await this.isEngineAvailable();
    const canListScopes = engineAvailabilityTest.success;
    if (!canListScopes) {
      this.logger.warn(this.id, "Cannot list scopes - host or controller is not available", {
        settings
      });
    }
    let commandLauncher = "";
    if (this.isScoped()) {
      commandLauncher = await this.getControllerLauncherPath();
    } else {
      commandLauncher = settings.program?.path || settings.program?.name || "";
    }
    const items = canListScopes ? await getAvailablePodmanMachines(commandLauncher, customFormat) : [];
    return items;
  }

  async connectToPodmanMachine(name: string, title?: string): Promise<boolean> {
    this.logger.debug("Connecting to machine", name, title);
    const settings = await this.getSettings();
    let commandLauncher = "";
    if (this.isScoped()) {
      commandLauncher = await this.getControllerLauncherPath();
    } else {
      commandLauncher = settings.program?.path || settings.program?.name || "";
    }
    const commandArgs = ["machine", "ssh", name];
    const output = await Platform.launchTerminal(commandLauncher, commandArgs, {
      title: title || `${this.ENGINE} machine`
    });
    if (!output.success) {
      this.logger.error("Unable to connect to machine", name, title, output);
    }
    return output.success;
  }

  async restartPodmanMachine(name: string): Promise<boolean> {
    this.logger.debug("Restarting machine", name);
    const stop = await this.stopPodmanMachine(name);
    const status = stop ? await this.startPodmanMachine(name) : StartupStatus.ERROR;
    return status === StartupStatus.STARTED || status === StartupStatus.RUNNING;
  }

  async getControllerLauncherPath(): Promise<string> {
    const { program, controller } = await this.getSettings();
    let programLauncher = "";
    if (this.isScoped()) {
      if (!controller) {
        throw new Error("Controller is not set");
      }
      programLauncher = controller.path;
      if (isEmpty(programLauncher)) {
        programLauncher = controller.name;
        try {
          const programPath = await findProgramPath(controller.name, { osType: Platform.OPERATING_SYSTEM });
          if (programPath) {
            programLauncher = programPath;
          } else {
            this.logger.warn("(detect) Program path is empty - using controller name", controller);
          }
        } catch (error: any) {
          this.logger.error("(detect) Program path is empty - using controller name", controller, error.message);
        }
      }
    } else {
      programLauncher = program.path;
      if (isEmpty(programLauncher)) {
        programLauncher = program.name;
        this.logger.warn("Program path is empty - using program name", program);
      }
    }
    return programLauncher;
  }

  async stopPodmanMachine(name: string): Promise<boolean> {
    this.logger.debug("Stopping podman machine", name);
    const programLauncher = await this.getControllerLauncherPath();
    const check = await this.runHostCommand(programLauncher, ["machine", "stop", name]);
    return check.success;
  }

  async startPodmanMachine(name: string): Promise<StartupStatus> {
    let machineName = name;
    if (!machineName) {
      this.logger.warn("Machine name is not set - attempting to use default");
      const machines = await this.getPodmanMachines();
      const defaultMachine = machines.find((it) => it.Default === true);
      machineName = defaultMachine?.Name || "podman-machine-default";
      if (defaultMachine?.Running) {
        this.logger.warn("Default machine is already running", defaultMachine.Name);
        return StartupStatus.RUNNING;
      }
    }
    const programLauncher = await this.getControllerLauncherPath();
    try {
      const status = await this.getPodmanMachineInspect(machineName);
      if (status?.State === "running") {
        this.logger.warn("Machine is already running", machineName);
        return StartupStatus.RUNNING;
      }
    } catch (error: any) {
      this.logger.error("Unable to check machine status", name, error.message);
    }
    const check = await this.runHostCommand(programLauncher, ["machine", "start", name]);
    return check.success ? StartupStatus.STARTED : StartupStatus.ERROR;
  }

  async removePodmanMachine(name: string): Promise<boolean> {
    const stopped = await this.stopPodmanMachine(name);
    if (!stopped) {
      this.logger.warn("Unable to stop machine before removal");
      return false;
    }
    const { program } = await this.getSettings();
    if (isEmpty(program.path)) {
      this.logger.error("Unable to remove machine - program path is empty", program);
      throw new Error("Program path is empty");
    }
    const check = await this.runHostCommand(program.path || "", ["machine", "rm", name, "--force"]);
    return check.success;
  }

  async createPodmanMachine(opts: CreateMachineOptions) {
    const { program } = await this.getSettings();
    if (isEmpty(program.path)) {
      this.logger.error("Unable to create machine - program path is empty", program);
      throw new Error("Program path is empty");
    }
    const output = await this.runHostCommand(program.path || "", [
      "machine",
      "init",
      "--cpus",
      `${opts.cpus}`,
      "--disk-size",
      `${opts.diskSize}`,
      "--memory",
      `${opts.ramSize}`,
      opts.name
    ]);
    if (!output.success) {
      this.logger.error("Unable to create machine", opts, output);
    }
    return output.success;
  }

  // explicit shared

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
    let result: CommandExecutionResult;
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
    let result: CommandExecutionResult;
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

  // override

  async getSystemInfo(connection?: Connection, customFormat?: string, customSettings?: EngineConnectorSettings) {
    let info: SystemInfo = {} as SystemInfo;
    let result: CommandExecutionResult;
    const settings = customSettings || (await this.getSettings());
    const programPath = settings.program.path || settings.program.name || "";
    if (this.isScoped()) {
      if (this.HOST === ContainerEngineHost.PODMAN_VIRTUALIZED_VENDOR) {
        const controllerPath = await this.getControllerLauncherPath();
        result = await this.runHostCommand(controllerPath, ["system", "info", "--format", customFormat || "json"], customSettings);
      } else {
        result = await this.runScopeCommand(programPath, ["system", "info", "--format", customFormat || "json"], settings.controller?.scope || "", customSettings);
      }
    } else {
      result = await this.runHostCommand(programPath, ["system", "info", "--format", customFormat || "json"], customSettings);
    }
    if (!result.success) {
      this.logger.error(this.id, "Unable to get system info", result);
      return info;
    }
    try {
      info = result.stdout ? JSON.parse(result.stdout) : info;
    } catch (error: any) {
      this.logger.error(this.id, "Unable to decode system info", error, result);
    }
    return info;
  }
}
