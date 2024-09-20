import { EngineConnectorSettings, PodmanMachineInspect } from "@/env/Types";
import { AbstractContainerEngineHostClient } from "../abstract";

export async function getPodmanMachineInspect(client: AbstractContainerEngineHostClient, customSettings?: EngineConnectorSettings) {
  const settings = customSettings || (await client.getSettings());
  let inspect: PodmanMachineInspect | undefined;
  const controllerPath = settings.controller?.path || settings.controller?.name;
  if (!controllerPath) {
    client.logger.error(client.id, "Unable to inspect - no program");
    return inspect;
  }
  const machineName = settings.controller?.scope;
  if (!machineName) {
    client.logger.error(client.id, "Unable to inspect - no machine");
    return inspect;
  }
  try {
    const command = ["machine", "inspect", machineName];
    const result: any = await client.runHostCommand(controllerPath, command, settings);
    if (!result.success) {
      client.logger.error(client.id, "Unable to inspect", result);
      return inspect;
    }
    try {
      const items: PodmanMachineInspect[] = JSON.parse(result.stdout || "[]");
      const targetMachine = items.find((it) => it.Name === machineName);
      return targetMachine;
    } catch (error: any) {
      client.logger.error(client.id, "Unable to inspect", error, result);
    }
  } catch (error: any) {
    client.logger.error(client.id, "Unable to inspect - execution error", error.message, error.stack);
  }
  return inspect;
}
