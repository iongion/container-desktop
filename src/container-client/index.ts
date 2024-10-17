export * from "./connection";
export * from "./runner";
export * from "./runtimes";
export * from "./types";

import type { Connection, OperatingSystem } from "@/env/Types";
import { Docker } from "./runtimes/docker";
import { Podman } from "./runtimes/podman";

export const RUNTIMES = [Podman.Engine, Docker.Engine];
export async function createContainerEngineHostClient(connection: Connection, osType: OperatingSystem) {
  const Engine = RUNTIMES.find((Engine) => Engine.ENGINE === connection.engine);
  if (!Engine) {
    throw new Error(`No engine found for ${connection.engine}`);
  }
  const engine = await Engine.create(osType);
  const clientEngine = await engine.createEngineHostClientByName(connection.host, connection.id);
  clientEngine.setSettings(connection.settings);
  return clientEngine;
}
