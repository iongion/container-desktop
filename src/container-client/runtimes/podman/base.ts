import { isEmpty } from "lodash-es";

import { AbstractClientEngine, ClientEngine } from "@/container-client/runtimes/abstract";
import { getAvailablePodmanMachines } from "@/detector";
import { CommandExecutionResult, Connection, ContainerEngine, CreateMachineOptions, SystemInfo } from "@/env/Types";
import { launchTerminal } from "@/terminal";

export interface PodmanClientEngineCommon extends ClientEngine {
  getPodLogs: (id?: any, tail?: any) => Promise<CommandExecutionResult>;
  generateKube: (id?: any, tail?: any) => Promise<CommandExecutionResult>;
}

export abstract class PodmanAbstractClientEngine extends AbstractClientEngine implements PodmanClientEngineCommon {
  async getPodmanMachines(customFormat?: string) {
    this.logger.debug(this.id, "getMachines with program");
    const settings = await this.getSettings();
    const engineAvailabilityTest = await this.isEngineAvailable();
    const canListScopes = engineAvailabilityTest.success;
    if (!canListScopes) {
      this.logger.warn(this.id, "Cannot list scopes - engine or controller is not available", {
        settings
      });
    }
    let commandLauncher = "";
    if (this.isScoped()) {
      commandLauncher = settings.controller?.path || settings.controller?.name || "";
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
      commandLauncher = settings.controller?.path || settings.controller?.name || "";
    } else {
      commandLauncher = settings.program?.path || settings.program?.name || "";
    }
    const commandArgs = ["machine", "ssh", name];
    const output = await launchTerminal(commandLauncher, commandArgs, {
      title: title || `${this.RUNTIME} machine`
    });
    if (!output.success) {
      this.logger.error("Unable to connect to machine", name, title, output);
    }
    return output.success;
  }

  async restartPodmanMachine(name: string): Promise<boolean> {
    const stop = await this.stopPodmanMachine(name);
    const success = stop ? await this.startPodmanMachine(name) : false;
    return success;
  }

  async stopPodmanMachine(name: string): Promise<boolean> {
    const { program, controller } = await this.getSettings();
    let programLauncher = "";
    if (this.isScoped()) {
      if (!controller) {
        throw new Error("Controller is not set");
      }
      programLauncher = controller.path;
      if (isEmpty(programLauncher)) {
        programLauncher = controller.name;
        this.logger.warn("Program path is empty - using controller name", controller);
      }
    } else {
      programLauncher = program.path;
      if (isEmpty(programLauncher)) {
        programLauncher = program.name;
        this.logger.warn("Program path is empty - using program name", program);
      }
    }
    const check = await this.runHostCommand(programLauncher, ["machine", "stop", name]);
    return check.success;
  }

  async startPodmanMachine(name: string): Promise<boolean> {
    const { program, controller } = await this.getSettings();
    let programLauncher = "";
    if (this.isScoped()) {
      if (!controller) {
        throw new Error("Controller is not set");
      }
      programLauncher = controller.path;
      if (isEmpty(programLauncher)) {
        programLauncher = controller.name;
        this.logger.warn("Program path is empty - using controller name", controller);
      }
    } else {
      programLauncher = program.path;
      if (isEmpty(programLauncher)) {
        programLauncher = program.name;
        this.logger.warn("Program path is empty - using program name", program);
      }
    }
    const check = await this.runHostCommand(programLauncher, ["machine", "start", name]);
    return check.success;
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

  async inspectPodmanMachine(name: string) {
    const machines = await this.getPodmanMachines();
    return machines.find((it) => it.Name === name);
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

  async getSystemInfo(connection?: Connection, customFormat?: string) {
    let info: SystemInfo = {} as SystemInfo;
    let result: CommandExecutionResult;
    const settings = await this.getSettings();
    const programPath = settings.program.path || settings.program.name || "";
    if (this.isScoped()) {
      if (this.ENGINE === ContainerEngine.PODMAN_VIRTUALIZED_VENDOR) {
        const controllerPath = settings.controller?.path || settings.controller?.name || "";
        result = await this.runHostCommand(controllerPath, ["system", "info", "--format", customFormat || "json"]);
      } else {
        result = await this.runScopeCommand(programPath, ["system", "info", "--format", customFormat || "json"], settings.controller?.scope || "");
      }
    } else {
      result = await this.runHostCommand(programPath, ["system", "info", "--format", customFormat || "json"]);
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
