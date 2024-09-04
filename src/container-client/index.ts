export * from "./connection";
export * from "./runner";
export * from "./runtimes";
export * from "./types";

import { Connection } from "@/env/Types";
import { OperatingSystem } from "@/platform";
import { Docker } from "./runtimes/docker";
import { Podman } from "./runtimes/podman";

export const RUNTIMES = [Podman.Runtime, Docker.Runtime];
export async function createClientEngine(connection: Connection, osType: OperatingSystem) {
  const Runtime = RUNTIMES.find((Runtime) => Runtime.RUNTIME === connection.runtime);
  if (!Runtime) {
    throw new Error(`No runtime found for ${connection.runtime}`);
  }
  const runtime = await Runtime.create(osType);
  const clientEngine = await runtime.createEngineByName(connection.engine, connection.id);
  clientEngine.setSettings(connection.settings);
  return clientEngine;
}
