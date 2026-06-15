import { describe, expect, it, vi } from "vitest";

import { getDefaultConnectors } from "@/container-client/connection";
import { createComposedHostClient } from "@/container-client/runtimes/registry";
import { ContainerEngine, ContainerEngineHost, OperatingSystem } from "@/env/Types";

// getAvailability orchestrates the per-dimension checks. These tests pin the scope-aware
// behaviour (#186 follow-up): native hosts have no controller/scope, so those dimensions must
// be "not applicable" (undefined) rather than a misleading "Path not set" failure, and the
// real API failure reason must survive to availability.report.api.

async function makeClient(engine: ContainerEngine, host: ContainerEngineHost, osType: OperatingSystem) {
  const connector = getDefaultConnectors(osType).find((c) => c.engine === engine && c.host === host);
  expect(connector).toBeDefined();
  const client = await createComposedHostClient(connector!, osType);
  return { client, settings: connector!.settings };
}

describe("getAvailability — scope awareness", () => {
  it("marks controller/scope not-applicable for native hosts and preserves the API reason", async () => {
    const { client, settings } = await makeClient(
      ContainerEngine.PODMAN,
      ContainerEngineHost.PODMAN_NATIVE,
      OperatingSystem.Linux,
    );
    expect(client.isScoped()).toBe(false);
    vi.spyOn(client, "isEngineAvailable").mockResolvedValue({ success: true, details: "Host is available" });
    vi.spyOn(client, "isProgramAvailable").mockResolvedValue({ success: true, details: "Program is available" });
    vi.spyOn(client, "isApiRunning").mockResolvedValue({
      success: false,
      details: "API is not reachable at unix:///wrong/path.sock - start manually or connect",
    });

    const availability = await client.getAvailability(settings);

    // Not applicable, not a failure with "Path not set".
    expect(availability.controller).toBeUndefined();
    expect(availability.controllerScope).toBeUndefined();
    expect(availability.report.controller).toBeUndefined();
    expect(availability.report.controllerScope).toBeUndefined();
    // Program lives on the host for native and is still checked.
    expect(availability.program).toBe(true);
    // The specific API reason survives instead of a generic "API is not running".
    expect(availability.api).toBe(false);
    expect(availability.report.api).toBe("API is not reachable at unix:///wrong/path.sock - start manually or connect");
    // The single user-facing reason points at the real failing dimension (api), not "Path not set".
    expect(availability.reason).toEqual({
      dimension: "api",
      details: "API is not reachable at unix:///wrong/path.sock - start manually or connect",
    });
  });

  it("reports the controller dimension for scoped hosts (SSH remote)", async () => {
    const { client, settings } = await makeClient(
      ContainerEngine.DOCKER,
      ContainerEngineHost.DOCKER_REMOTE,
      OperatingSystem.Linux,
    );
    expect(client.isScoped()).toBe(true);
    vi.spyOn(client, "isEngineAvailable").mockResolvedValue({ success: true, details: "Host is available" });
    vi.spyOn(client, "isControllerAvailable").mockResolvedValue({ success: false, details: "ssh not found in path" });
    vi.spyOn(client, "isApiRunning").mockResolvedValue({ success: false, details: "no api" });

    const availability = await client.getAvailability(settings);

    expect(availability.controller).toBe(false);
    expect(availability.report.controller).toBe("ssh not found in path");
    // Root-cause walk surfaces the first failing dimension (controller), not the downstream api.
    expect(availability.reason).toEqual({ dimension: "controller", details: "ssh not found in path" });
  });
});
