export * from "./connection";
export * from "./runner";
export * from "./runtimes";
export * from "./types";

import type { Connection, OperatingSystem } from "@/env/Types";
import { createComposedHostClient } from "./runtimes/registry";

export async function createContainerEngineHostClient(connection: Connection, osType: OperatingSystem) {
  const clientEngine = await createComposedHostClient(connection, osType);
  clientEngine.setSettings(connection.settings);
  return clientEngine;
}
