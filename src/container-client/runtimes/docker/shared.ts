import type { CommandExecutionResult, ContextInspect, EngineConnectorSettings } from "@/env/Types";
import type { AbstractContainerEngineHostClient } from "../abstract";

export async function getContextInspect(
  client: AbstractContainerEngineHostClient,
  customFormat?: string,
  customSettings?: EngineConnectorSettings,
) {
  let info: ContextInspect = {} as ContextInspect;
  let result: CommandExecutionResult;
  const settings = customSettings || (await client.getSettings());
  const programPath = settings.program.path || settings.program.name || "";
  if (client.isScoped()) {
    result = await client.runScopeCommand(
      programPath,
      ["context", "inspect", "--format", customFormat || "json"],
      settings.controller?.scope || "",
      settings,
    );
  } else {
    result = await client.runHostCommand(
      programPath,
      ["context", "inspect", "--format", customFormat || "json"],
      settings,
    );
  }
  if (!result.success) {
    client.logger.error(client.id, "Unable to get context inspect", result);
    return info;
  }
  try {
    const contextList: ContextInspect[] = result.stdout ? JSON.parse(result.stdout) : [];
    if (contextList.length > 0) {
      info = contextList[0];
    }
  } catch (error: any) {
    client.logger.error(client.id, "Unable to decode context inspect", error, result);
  }
  return info;
}
