import { describe, expect, it } from "vitest";
import { getDefaultConnectors } from "@/container-client/connection";
import { createComposedHostClient } from "@/container-client/runtimes/registry";
import { ContainerEngine, ContainerEngineHost } from "@/container-client/types/engine";
import { OperatingSystem } from "@/container-client/types/os";

describe("headless bootstrap", () => {
  it("constructs a PODMAN_NATIVE host client under plain Node (globals wired, no Electron)", async () => {
    const connector = getDefaultConnectors(OperatingSystem.Linux).find(
      (c) => c.engine === ContainerEngine.PODMAN && c.host === ContainerEngineHost.PODMAN_NATIVE,
    );
    expect(connector).toBeDefined();

    const client = await createComposedHostClient(connector!, OperatingSystem.Linux);

    expect(client.ENGINE).toBe(ContainerEngine.PODMAN);
    expect(client.HOST).toBe(ContainerEngineHost.PODMAN_NATIVE);
    expect(client.PROGRAM).toBe("podman");
  });
});
