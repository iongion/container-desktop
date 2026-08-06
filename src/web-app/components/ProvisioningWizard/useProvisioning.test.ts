import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Connection } from "@/container-client/types/connection";
import { ContainerEngine } from "@/container-client/types/engine";
import type { IHostRuntime } from "@/platform/contract";
import { registerHostRuntime, resetHostRuntime } from "@/platform/provider";
import { configureAssistantOnEngine } from "@/web-app/components/ProvisioningWizard/useProvisioning";
import { useAppStore } from "@/web-app/stores/appStore";
import { useResourceStore } from "@/web-app/stores/resourceStore";

const HOME = "/home/tester";

function withHomeDir(homeDir: string) {
  registerHostRuntime({ platform: { getHomeDir: async () => homeDir } } as IHostRuntime);
}

// Stand the two stores `configureAssistantOnEngine` reads up as a single connected connection, and replace the
// settings writer so what it was asked to persist can be asserted without an Application behind it.
function withConnection(engine: ContainerEngine, ai?: Record<string, unknown>) {
  const setGlobalUserSettings = vi.fn(async () => {});
  useAppStore.setState({
    connections: [{ id: "conn-1", engine } as Connection],
    userSettings: { ai } as never,
    setGlobalUserSettings,
  });
  useResourceStore.setState({ activeRuntime: [{ id: "conn-1", running: true }] as never });
  return setGlobalUserSettings;
}

function writtenSessions(spy: ReturnType<typeof vi.fn>) {
  return spy.mock.calls[0]?.[0]?.ai?.defaultSessions;
}

describe("configureAssistantOnEngine", () => {
  beforeEach(() => {
    withHomeDir(HOME);
  });

  afterEach(() => {
    resetHostRuntime();
    useResourceStore.setState({ activeRuntime: [] });
  });

  it("mounts an absolute folder, never a bare tilde, when no workspace root is set", async () => {
    // The path becomes `<path>:/workspace` argv for the engine, with no shell to expand anything: a `~` arrives
    // literally and is read as a volume NAME, which podman refuses outright.
    const write = withConnection(ContainerEngine.PODMAN);

    const connectionId = await configureAssistantOnEngine(ContainerEngine.PODMAN);

    expect(connectionId).toBe("conn-1");
    expect(writtenSessions(write)?.["conn-1"]).toEqual({ workspacePath: HOME });
  });

  it("keeps the workspace the user already chose", async () => {
    const write = withConnection(ContainerEngine.PODMAN, { workspaceRoot: "/home/tester/project" });

    await configureAssistantOnEngine(ContainerEngine.PODMAN);

    expect(writtenSessions(write)?.["conn-1"]).toEqual({ workspacePath: "/home/tester/project" });
  });

  it("writes nothing when no folder can be resolved", async () => {
    withHomeDir("");
    const write = withConnection(ContainerEngine.PODMAN);

    expect(await configureAssistantOnEngine(ContainerEngine.PODMAN)).toBeUndefined();
    expect(write).not.toHaveBeenCalled();
  });

  it("writes nothing when the provisioned engine has no connected connection yet", async () => {
    const write = withConnection(ContainerEngine.PODMAN);

    expect(await configureAssistantOnEngine(ContainerEngine.DOCKER)).toBeUndefined();
    expect(write).not.toHaveBeenCalled();
  });

  it("leaves a session the connection already has alone", async () => {
    const write = withConnection(ContainerEngine.PODMAN, {
      defaultSessions: { "conn-1": { workspacePath: "/home/tester/existing" } },
    });

    expect(await configureAssistantOnEngine(ContainerEngine.PODMAN)).toBe("conn-1");
    expect(write).not.toHaveBeenCalled();
  });

  it("merges into the other connections' sessions rather than replacing them", async () => {
    const write = withConnection(ContainerEngine.PODMAN, {
      defaultSessions: { "conn-2": { workspacePath: "/home/tester/other" } },
    });

    await configureAssistantOnEngine(ContainerEngine.PODMAN);

    expect(writtenSessions(write)).toEqual({
      "conn-2": { workspacePath: "/home/tester/other" },
      "conn-1": { workspacePath: HOME },
    });
  });
});
