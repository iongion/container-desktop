// Lazy, production-excluded accessor for the fixture data. `PROD` is a compile-time constant (Vite
// replaces import.meta.env.ENVIRONMENT), so in a production build `if (PROD) { throw }` makes the
// dynamic import unreachable and the bundler drops ./fixtures — and therefore all the JSON — from the
// shipped output. In dev/test the import runs once and is cached.

import type { ContainerEngine } from "@/env/Types";
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
