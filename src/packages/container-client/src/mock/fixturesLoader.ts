import type { ContainerEngine } from "@/container-client/types/engine";
import type { EngineFixtures } from "./fixtures";

const PROD = import.meta.env.ENVIRONMENT === "production";

let modulePromise: Promise<typeof import("./fixtures")> | undefined;

export async function loadEngineFixtures(engine: ContainerEngine): Promise<EngineFixtures> {
  if (PROD) {
    throw new Error("Mock fixtures are not available in production builds");
  }
  modulePromise ??= import("./fixtures");
  const mod = await modulePromise;
  return mod.getEngineFixtures(engine);
}
