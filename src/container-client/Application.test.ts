import { describe, expect, it } from "vitest";
import { Application } from "@/container-client/Application";
import { type Connection, ContainerEngineHost, type EngineConnectorSettings, OperatingSystem } from "@/env/Types";

// Construct a bare Application for a given client OS (constructor only sets fields + a no-op
// UserConfiguration), then reach the protected helper. The helper derives the LOCAL forward-socket
// address an SSH tunnel needs — the fix that makes the autostart/Connect path match start().
function appFor(osType: OperatingSystem): any {
  return new Application({ osType, version: "test", environment: "test", messageBus: {} as any });
}

function emptyUriSettings(): EngineConnectorSettings {
  return {
    api: { baseURL: "http://d", connection: { uri: "", relay: "" } },
    program: { name: "podman", path: "" },
    rootfull: false,
    mode: "mode.automatic",
  };
}

const conn = (host: ContainerEngineHost): Connection => ({ id: "demo", host }) as unknown as Connection;

describe("Application.ensureRemoteForwardAddress", () => {
  it("derives a local forward socket for remote SSH hosts when the uri is empty (Linux/macOS)", async () => {
    const app = appFor(OperatingSystem.Linux);
    const settings = emptyUriSettings();
    await app.ensureRemoteForwardAddress(conn(ContainerEngineHost.PODMAN_REMOTE), settings);
    expect(settings.api.connection.uri).toContain("container-desktop-ssh-relay-demo");
  });

  it("uses the Windows named pipe for remote SSH hosts on Windows", async () => {
    const app = appFor(OperatingSystem.Windows);
    const settings = emptyUriSettings();
    await app.ensureRemoteForwardAddress(conn(ContainerEngineHost.DOCKER_REMOTE), settings);
    expect(settings.api.connection.uri).toContain("container-desktop-ssh-relay-demo");
    expect(settings.api.connection.uri).toMatch(/pipe/i);
  });

  it("leaves native hosts untouched", async () => {
    const app = appFor(OperatingSystem.Linux);
    const settings = emptyUriSettings();
    await app.ensureRemoteForwardAddress(conn(ContainerEngineHost.PODMAN_NATIVE), settings);
    expect(settings.api.connection.uri).toBe("");
  });

  it("never overrides an already-set uri (e.g. a manual connection)", async () => {
    const app = appFor(OperatingSystem.Linux);
    const settings = emptyUriSettings();
    settings.api.connection.uri = "/tmp/preset.sock";
    await app.ensureRemoteForwardAddress(conn(ContainerEngineHost.DOCKER_REMOTE), settings);
    expect(settings.api.connection.uri).toBe("/tmp/preset.sock");
  });
});

describe("Application.getGlobalUserSettings — AI back-compat", () => {
  it("populates safe, local-first AI defaults when the stored config has no ai section", async () => {
    const app = appFor(OperatingSystem.Linux);
    // Simulate an older config: no `ai` key present (and isolate from the host's real config file).
    app.userConfiguration = {
      getKey: async (name: string, defaultValue?: any) => (name === "ai" ? undefined : defaultValue),
      getStoragePath: async () => "/tmp",
    } as any;
    app.getConnectionsFromConfiguration = async () => [];

    const settings = await app.getGlobalUserSettings();

    expect(settings.ai).toBeDefined();
    expect(settings.ai.defaultProvider).toBe("lmstudio");
    expect(settings.ai.webSearch).toBe(false);
    expect(settings.ai.providers.llamacpp.baseURL).toBe("http://127.0.0.1:8080/v1");
  });
});
