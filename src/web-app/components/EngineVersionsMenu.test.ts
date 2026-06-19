import { describe, expect, it } from "vitest";

import type { EngineInventory } from "./EngineVersionsMenu";
import { engineInventoryTriggerLabel } from "./EngineVersionsMenu";

const inventory = (groups: EngineInventory["groups"]): EngineInventory => ({
  groups,
  engineCount: groups.flatMap((group) => group.engines).length,
  runningCount: groups.flatMap((group) => group.engines).filter((engine) => engine.running).length,
});

describe("engineInventoryTriggerLabel", () => {
  it("shows connected system engine versions when system connections are running", () => {
    expect(
      engineInventoryTriggerLabel(
        inventory([
          {
            id: "system-default",
            name: "System",
            engines: [
              {
                id: "system-default.podman",
                connectionName: "System Podman",
                engine: "podman",
                phase: "ready",
                running: true,
                version: "5.7.0",
              },
              {
                id: "system-default.docker",
                connectionName: "System Docker",
                engine: "docker",
                phase: "ready",
                running: true,
                version: "29.5.3",
              },
            ],
          },
          {
            id: "system-env.mac",
            name: "MacOS",
            engines: [
              {
                id: "system-env.mac.docker",
                connectionName: "MacOS (docker)",
                engine: "docker",
                phase: "ready",
                running: true,
                version: "29.6.0",
              },
            ],
          },
        ]),
        "Engines",
      ),
    ).toBe("podman 5.7.0 / docker 29.5.3");
  });

  it("falls back to connected non-system engine names without versions", () => {
    expect(
      engineInventoryTriggerLabel(
        inventory([
          {
            id: "system-default",
            name: "System",
            engines: [
              {
                id: "system-default.podman",
                connectionName: "System Podman",
                engine: "podman",
                phase: "idle",
                running: false,
                version: "5.7.0",
              },
            ],
          },
          {
            id: "system-env.mac",
            name: "MacOS",
            engines: [
              {
                id: "system-env.mac.podman",
                connectionName: "MacOS (podman)",
                engine: "podman",
                phase: "ready",
                running: true,
                version: "5.2.2",
              },
              {
                id: "system-env.mac.docker",
                connectionName: "MacOS (docker)",
                engine: "docker",
                phase: "ready",
                running: true,
                version: "29.6.0",
              },
            ],
          },
        ]),
        "Engines",
      ),
    ).toBe("podman / docker");
  });
});
