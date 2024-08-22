import { Connector } from "@/env/Types";
import { AbstractClientEngine } from "../runtimes/abstract";

export async function getPodmanApiRelay(engine: AbstractClientEngine, connector: Connector) {
  let relay: string | undefined;
  if (connector.availability.engine && connector.availability.controller) {
    const scope = connector.settings.controller?.scope;
    if (!scope) {
      engine.logger.error(connector.id, "Unable to get relay - scope is not set");
      return relay;
    }
    engine.logger.debug(connector.id, ">> Getting relay for scope", scope);
    const result = await engine.runScopeCommand("podman", ["system", "info", "--format", "json"], scope);
    if (result.success) {
      try {
        const info = JSON.parse(result.stdout || "{}");
        relay = info.host?.remoteSocket?.path || "";
      } catch (error: any) {
        engine.logger.error(connector.id, "Unable to parse relay", scope, result, error);
      }
    } else {
      engine.logger.error(connector.id, "Unable to get relay", result);
    }
    engine.logger.debug(connector.id, "<< Getting relay for scope", scope, result);
  }
  return relay;
}
