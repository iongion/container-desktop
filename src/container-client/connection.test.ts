import { describe, expect, it } from "vitest";
import { ContainerEngineHost, OperatingSystem } from "@/env/Types";
import { createConnectorSettings, WSL_PROGRAM } from "./connection";

describe("createConnectorSettings", () => {
  it("preserves controller overrides (scope, path, version)", () => {
    const settings = createConnectorSettings({
      osType: OperatingSystem.Windows,
      host: ContainerEngineHost.PODMAN_VIRTUALIZED_WSL,
      programName: "podman",
      controllerName: WSL_PROGRAM,
      overrides: {
        controller: { name: WSL_PROGRAM, path: "/usr/bin/wsl", version: "2", scope: "Ubuntu-24.04" },
      },
    });
    // The live harness (PR 3) relies on a target-provided controller.scope (WSL distro /
    // LIMA instance / podman machine) flowing through createConnectorSettings.
    expect(settings.controller?.scope).toBe("Ubuntu-24.04");
    expect(settings.controller?.path).toBe("/usr/bin/wsl");
    expect(settings.controller?.version).toBe("2");
  });
});
