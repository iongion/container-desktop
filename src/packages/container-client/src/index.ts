export * from "./connection";
export * from "./runner";
export * from "./runtimes";

import type { Connection } from "@/container-client/types/connection";
import type { OperatingSystem } from "@/container-client/types/os";
import { createComposedHostClient } from "./runtimes/registry";

export async function createContainerEngineHostClient(connection: Connection, osType: OperatingSystem) {
  const clientEngine = await createComposedHostClient(connection, osType);
  clientEngine.setSettings(connection.settings);
  return clientEngine;
}
