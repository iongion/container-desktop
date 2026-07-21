import { afterEach, describe, expect, it } from "vitest";
import { installFakeCommand } from "@/__tests__/setup/fakeCommand";
import { getDefaultConnectors } from "@/container-client/connection";
import { createComposedHostClient } from "@/container-client/runtimes/registry";
import type { EngineConnectorSettings } from "@/container-client/types/connection";
import { ContainerEngineHost } from "@/container-client/types/engine";
import { OperatingSystem } from "@/container-client/types/os";

// A local path guaranteed NOT to exist on the test machine — the whole point is that a scoped host's
// engine binary lives on the remote/VM, so a local existence check must never decide availability.
const ABSENT_LOCAL = "/nonexistent/bin/podman";

async function clientFor(host: ContainerEngineHost, osType: OperatingSystem) {
  const connector = getDefaultConnectors(osType).find((c) => c.host === host)!;
  const client = await createComposedHostClient(connector, osType);
  const settings = structuredClone(connector.settings) as EngineConnectorSettings;
  settings.program.name = "podman";
  settings.program.path = ABSENT_LOCAL;
  if (settings.controller) {
    settings.controller.scope = "default";
  }
  return { client, settings };
}

describe("HostClient.isProgramAvailable — scoped runs in the host, native runs locally", () => {
  let cmd: ReturnType<typeof installFakeCommand>;
  afterEach(() => cmd?.restore());

  it("scoped host verifies the engine IN THE HOST (which over the scope), ignoring local FS", async () => {
    cmd = installFakeCommand(); // every command succeeds
    const { client, settings } = await clientFor(ContainerEngineHost.PODMAN_VIRTUALIZED_LIMA, OperatingSystem.MacOS);
    expect(client.isScoped()).toBe(true);

    const result = await client.isProgramAvailable(settings);

    expect(result.success).toBe(true);
    // Proof it executed in the host: a scope probe (limactl shell <scope> which podman) was issued.
    const probe = cmd.calls.find((c) => c.args.includes("which") && c.args.includes("podman"));
    expect(probe?.launcher).toBe("limactl");
    expect(probe?.args).toContain("shell");
  });

  it("scoped host reports which engine is absent in the host", async () => {
    cmd = installFakeCommand((call) => (call.args.includes("which") ? { success: false, code: 1 } : {}));
    const { client, settings } = await clientFor(ContainerEngineHost.PODMAN_VIRTUALIZED_LIMA, OperatingSystem.MacOS);

    const result = await client.isProgramAvailable(settings);

    expect(result.success).toBe(false);
    expect(result.details).toBe('Program "podman" was not found');
  });

  it("native host uses the local filesystem and issues no scope command", async () => {
    cmd = installFakeCommand();
    const { client, settings } = await clientFor(ContainerEngineHost.PODMAN_NATIVE, OperatingSystem.Linux);
    expect(client.isScoped()).toBe(false);

    const result = await client.isProgramAvailable(settings);

    expect(result.success).toBe(false);
    expect(result.details).toBe(`Program "podman" was not found at ${ABSENT_LOCAL}`);
    expect(cmd.calls.find((c) => c.args.includes("which"))).toBeUndefined();
  });

  it("falls back to the host engine name without leaking 'Path not set'", async () => {
    cmd = installFakeCommand();
    const { client, settings } = await clientFor(ContainerEngineHost.PODMAN_NATIVE, OperatingSystem.Linux);
    settings.program.name = "";
    settings.program.path = "";

    const result = await client.isProgramAvailable(settings);

    expect(result.success).toBe(false);
    expect(result.details).toBe('Program "podman" was not detected on this machine');
  });

  it("controller availability names the missing controller instead of saying 'Path not set'", async () => {
    const { client, settings } = await clientFor(ContainerEngineHost.PODMAN_REMOTE, OperatingSystem.Linux);
    settings.controller = { name: "ssh", path: "", version: "current", scope: "MacOS" };

    const result = await client.isControllerAvailable(settings);

    expect(result.success).toBe(false);
    expect(result.details).toBe('Controller "ssh" was not detected on this machine');
  });

  it("marks native engine host commands for engine proxy env", async () => {
    cmd = installFakeCommand();
    const { client } = await clientFor(ContainerEngineHost.PODMAN_NATIVE, OperatingSystem.Linux);

    await client.runHostCommand("podman", ["image", "pull", "quay.io/podman/hello"]);

    expect(cmd.calls[0].launcher).toBe("podman");
    expect(cmd.calls[0].opts?.proxyEnv).toBe(true);
  });

  it("does not mark scoped controller commands for engine proxy env", async () => {
    cmd = installFakeCommand();
    const { client, settings } = await clientFor(ContainerEngineHost.PODMAN_VIRTUALIZED_LIMA, OperatingSystem.MacOS);

    await client.runScopeCommand("podman", ["info"], "default", settings);

    expect(cmd.calls[0].launcher).toBe("limactl");
    expect(cmd.calls[0].opts?.proxyEnv).toBeUndefined();
  });
});
