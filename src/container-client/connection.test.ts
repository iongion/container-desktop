import { describe, expect, it } from "vitest";
import { ContainerEngine, ContainerEngineHost, OperatingSystem } from "@/env/Types";
import {
  APPLE_PROGRAM,
  ContainerEngineOptions,
  createConnectorBy,
  createConnectorSettings,
  getDefaultConnectors,
  WSL_PROGRAM,
} from "./connection";

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
    // The live harness relies on a target-provided controller.scope (WSL distro / LIMA instance /
    // podman machine) flowing through createConnectorSettings.
    expect(settings.controller?.scope).toBe("Ubuntu-24.04");
    expect(settings.controller?.path).toBe("/usr/bin/wsl");
    expect(settings.controller?.version).toBe("2");
  });

  it("Apple program uses http://localhost baseURL (Docker REST surface)", () => {
    const settings = createConnectorSettings({
      osType: OperatingSystem.MacOS,
      host: ContainerEngineHost.APPLE_NATIVE,
      programName: APPLE_PROGRAM,
    });
    expect(settings.api.baseURL).toBe("http://localhost");
  });
});

describe("getDefaultConnectors — Apple connectors", () => {
  it("has exactly 12 connectors (10 existing + 2 Apple)", () => {
    const connectors = getDefaultConnectors(OperatingSystem.Linux);
    expect(connectors).toHaveLength(12);
  });

  it("APPLE_NATIVE connector exists and is gated to macOS only", () => {
    const macConnectors = getDefaultConnectors(OperatingSystem.MacOS);
    const appleNative = macConnectors.find(
      (c) => c.engine === ContainerEngine.APPLE && c.host === ContainerEngineHost.APPLE_NATIVE,
    );
    expect(appleNative).toBeDefined();
    expect(appleNative!.availability.enabled).toBe(true);
    expect(appleNative!.label).toBe("Native");

    const linuxConnectors = getDefaultConnectors(OperatingSystem.Linux);
    const disabledApple = linuxConnectors.find(
      (c) => c.engine === ContainerEngine.APPLE && c.host === ContainerEngineHost.APPLE_NATIVE,
    );
    expect(disabledApple!.availability.enabled).toBe(false);
  });

  it("APPLE_REMOTE connector exists and is always enabled", () => {
    const connectors = getDefaultConnectors(OperatingSystem.Linux);
    const appleRemote = connectors.find(
      (c) => c.engine === ContainerEngine.APPLE && c.host === ContainerEngineHost.APPLE_REMOTE,
    );
    expect(appleRemote).toBeDefined();
    expect(appleRemote!.availability.enabled).toBe(true);
    expect(appleRemote!.label).toBe("Remote SSH connection");
    expect(appleRemote!.settings.program.name).toBe(APPLE_PROGRAM);
    expect(appleRemote!.settings.controller?.name).toBe("ssh");
  });
});

describe("createConnectorBy — Apple dispatch", () => {
  it("Apple on macOS defaults to APPLE_NATIVE", async () => {
    const connector = await createConnectorBy(OperatingSystem.MacOS, ContainerEngine.APPLE);
    expect(connector.host).toBe(ContainerEngineHost.APPLE_NATIVE);
  });

  it("Apple on Linux defaults to APPLE_REMOTE", async () => {
    const connector = await createConnectorBy(OperatingSystem.Linux, ContainerEngine.APPLE);
    expect(connector.host).toBe(ContainerEngineHost.APPLE_REMOTE);
  });
});

describe("ContainerEngineOptions", () => {
  it("includes Container option for Apple", () => {
    const appleOption = ContainerEngineOptions.find((o) => o.engine === ContainerEngine.APPLE);
    expect(appleOption).toBeDefined();
    expect(appleOption!.label).toBe("Container");
  });
});
