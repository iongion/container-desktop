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

  it("probes the engine name it fell back to, never an empty argument", async () => {
    // The name is optional in persisted settings, and the host's own PROGRAM is the documented
    // fallback — the guard above this probe already uses it. Probing settings.program.name directly
    // asked the scope for `which ""`, which exits non-zero for a reason that has nothing to do with
    // whether the engine is installed.
    cmd = installFakeCommand();
    const { client, settings } = await clientFor(ContainerEngineHost.PODMAN_VIRTUALIZED_LIMA, OperatingSystem.MacOS);
    settings.program.name = "";

    await client.isProgramAvailable(settings);

    const probe = cmd.calls.find((c) => c.args.includes("which"));
    expect(probe?.args).toContain("podman");
    expect(probe?.args).not.toContain("");
  });
});

describe("HostClient.isControllerScopeAvailable — the scope, not the controller binary", () => {
  let cmd: ReturnType<typeof installFakeCommand>;
  afterEach(() => cmd?.restore());

  it("fails when the configured scope is not among the controller's scopes", async () => {
    // The defect this replaces: controllerScope re-ran the CONTROLLER check, so a present limactl
    // with a deleted instance reported a healthy scope and the engine probe then ran inside a scope
    // that does not exist — surfacing as a missing engine rather than a missing scope.
    cmd = installFakeCommand((call) => (call.args.includes("list") ? { success: true, stdout: "[]" } : {}));
    const { client, settings } = await clientFor(ContainerEngineHost.PODMAN_VIRTUALIZED_LIMA, OperatingSystem.MacOS);
    settings.controller = { name: "limactl", path: "/usr/bin/limactl", scope: "deleted-instance" };

    const result = await client.isControllerScopeAvailable(settings);

    expect(result.success).toBe(false);
    expect(result.details).toBe('Controller scope "deleted-instance" was not found');
  });

  it("fails when no scope is configured at all", async () => {
    const { client, settings } = await clientFor(ContainerEngineHost.PODMAN_VIRTUALIZED_LIMA, OperatingSystem.MacOS);
    settings.controller = { name: "limactl", path: "/usr/bin/limactl", scope: "" };

    const result = await client.isControllerScopeAvailable(settings);

    expect(result.success).toBe(false);
    expect(result.details).toBe("Controller scope is not configured");
  });
});

describe("HostClient.isApiAvailable — an address detection never resolved", () => {
  it("refuses an empty connection uri instead of calling the API configured", async () => {
    // `api.connection` is an object, so the guard that meant to catch "no connection string" was
    // testing a value that is always truthy: an empty uri sailed through and the check answered
    // "API is configured". The ping that followed was built on no address and failed with the vague
    // "API is not reachable", which is the reason this check exists to prevent.
    const { client, settings } = await clientFor(ContainerEngineHost.PODMAN_NATIVE, OperatingSystem.Linux);
    settings.api.baseURL = "http://d";
    settings.api.connection = { uri: "", relay: "" };
    await client.setSettings(settings);

    const result = await client.isApiAvailable();

    expect(result.success).toBe(false);
    expect(result.details).toBe("API connection string is not set");
  });

  // The Windows branch used to be `// TODO: Check named pipe` — an empty block, so a Windows
  // connection always passed this gate. It could not have been written before: isFilePresent reached
  // fs.existsSync, which is false for EVERY named pipe (it OPENS the path, and opening a pipe means
  // becoming a client of it), so checking one would have refused every Windows connection. The
  // platform host answers a pipe address by enumerating \\.\pipe\ now.
  it("refuses a Windows named pipe that nothing is serving", async () => {
    const { client, settings } = await clientFor(
      ContainerEngineHost.DOCKER_VIRTUALIZED_VENDOR,
      OperatingSystem.Windows,
    );
    settings.api.baseURL = "http://d";
    // A pipe name nothing will ever serve, so the answer does not depend on what is installed.
    settings.api.connection = { uri: "\\\\.\\pipe\\cdc-pipe-that-is-not-served", relay: "" };
    await client.setSettings(settings);

    const result = await client.isApiAvailable();

    expect(result.success).toBe(false);
    expect(result.details).toBe(
      "Nothing is serving the named pipe \\\\.\\pipe\\cdc-pipe-that-is-not-served — the engine is not running",
    );
  });
});

describe("HostClient.getAvailability — the api dimension rests on the ones before it", () => {
  let cmd: ReturnType<typeof installFakeCommand>;
  afterEach(() => cmd?.restore());

  it("does not dial the engine for a connector this OS cannot run", async () => {
    // podman.native is availableOn(Linux), so on Windows the host gate refuses. isApiRunning used to
    // be called anyway: it dialled, and its vague reason then OVERWROTE the precise one the host
    // check had just produced. Worse, a configured address that happened to answer would have set
    // `api: true` beside `host: false` — a connection reporting itself up on a host it cannot run on.
    cmd = installFakeCommand();
    const { client, settings } = await clientFor(ContainerEngineHost.PODMAN_NATIVE, OperatingSystem.Windows);
    settings.api.baseURL = "http://d";
    settings.api.connection = { uri: "\\\\.\\pipe\\docker_engine", relay: "" };
    await client.setSettings(settings);

    const availability = await client.getAvailability(settings);

    expect(availability.host).toBe(false);
    expect(availability.api).toBe(false);
    expect(availability.report.api).toBe("Not checked - host not available");
  });
});
