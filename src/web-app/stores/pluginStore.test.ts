import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PiBridgeClient } from "@/ai-system/adapters/piBridgeClient";
import type { BridgeEvent } from "@/pi-bridge/protocol";
import { useCodingAgentStore } from "@/web-app/stores/codingAgent";
import { emptyPluginState, usePluginStore } from "@/web-app/stores/pluginStore";

const CONFIGURED = [{ source: "npm:@foo/bar", scope: "user" as const, filtered: false, installedPath: "/pkgs/bar" }];
const RESOURCES = {
  extensions: [],
  commands: [{ name: "probe", source: "npm:@foo/bar" }],
  skills: [],
  prompts: [],
};

function attachFakeClient() {
  const listeners: Array<(event: BridgeEvent) => void> = [];
  const client = {
    listPlugins: vi.fn(async () => ({ configured: CONFIGURED })),
    listResources: vi.fn(async () => RESOURCES),
    installPlugin: vi.fn(async () => {}),
    removePlugin: vi.fn(async () => {}),
    updatePlugins: vi.fn(async () => {}),
    checkPluginUpdates: vi.fn(async () => ["npm:@foo/bar"]),
    setPluginEnabled: vi.fn(async () => {}),
    reloadSession: vi.fn(async () => {}),
    onEvent: vi.fn((listener: (event: BridgeEvent) => void) => {
      listeners.push(listener);
      return () => {};
    }),
  } as unknown as PiBridgeClient;
  useCodingAgentStore.setState({ client, status: "ready" });
  const emit = (event: BridgeEvent) => {
    for (const listener of listeners) listener(event);
  };
  return { client, emit };
}

beforeEach(() => {
  usePluginStore.setState(emptyPluginState());
  useCodingAgentStore.setState({ client: undefined, status: "idle" });
});

describe("usePluginStore", () => {
  it("builds rows from the configured packages and their contributions", async () => {
    attachFakeClient();
    await usePluginStore.getState().refresh();
    expect(usePluginStore.getState().rows).toEqual([
      {
        source: "npm:@foo/bar",
        name: "@foo/bar",
        kind: "npm",
        scope: "user",
        enabled: true,
        installed: true,
        commands: ["probe"],
        skills: [],
        prompts: [],
      },
    ]);
    expect(usePluginStore.getState().error).toBeUndefined();
  });

  it("reports no rows and no error when there is no session", async () => {
    await usePluginStore.getState().refresh();
    expect(usePluginStore.getState().rows).toEqual([]);
    expect(usePluginStore.getState().error).toBeUndefined();
  });

  it("keeps busy set for the duration of a mutation and clears it after", async () => {
    const { client } = attachFakeClient();
    let busyDuringCall = false;
    (client.installPlugin as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      busyDuringCall = usePluginStore.getState().busy;
    });
    await usePluginStore.getState().install("npm:@foo/baz", "user");
    expect(busyDuringCall).toBe(true);
    expect(usePluginStore.getState().busy).toBe(false);
  });

  it("refuses to install a source that fails validation, without touching the bridge", async () => {
    const { client } = attachFakeClient();
    await usePluginStore.getState().install("npm:foo;rm -rf /", "user");
    expect(client.installPlugin).not.toHaveBeenCalled();
    expect(usePluginStore.getState().error).toMatch(/shell/i);
  });

  it("keeps a failed install visible as an error and does not stay busy", async () => {
    const { client } = attachFakeClient();
    (client.installPlugin as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("registry down"));
    await usePluginStore.getState().install("npm:@foo/baz", "user");
    expect(usePluginStore.getState().error).toBe("registry down");
    expect(usePluginStore.getState().busy).toBe(false);
  });

  it("disables a plugin and reloads the session so its resources leave", async () => {
    const { client } = attachFakeClient();
    await usePluginStore.getState().setEnabled("npm:@foo/bar", false, "user");
    expect(client.setPluginEnabled).toHaveBeenCalledWith("npm:@foo/bar", false, "user");
    expect(client.reloadSession).toHaveBeenCalled();
  });

  it("shows install progress from the container and clears it when the phase completes", () => {
    attachFakeClient();
    usePluginStore.getState().applyBridgeEvent({
      type: "plugin_progress",
      source: "npm:@foo/baz",
      action: "install",
      phase: "progress",
      message: "fetching",
    });
    expect(usePluginStore.getState().progress).toEqual({ source: "npm:@foo/baz", message: "fetching" });
    usePluginStore.getState().applyBridgeEvent({
      type: "plugin_progress",
      source: "npm:@foo/baz",
      action: "install",
      phase: "complete",
    });
    expect(usePluginStore.getState().progress).toBeUndefined();
  });

  it("refetches when the container reports the installed set changed", async () => {
    const { client } = attachFakeClient();
    usePluginStore.getState().applyBridgeEvent({ type: "plugins_changed" });
    await vi.waitFor(() => expect(client.listPlugins).toHaveBeenCalled());
  });

  it("listens for plugin events while attached and refreshes once on attach", async () => {
    const { client, emit } = attachFakeClient();
    const detach = usePluginStore.getState().attach();
    await vi.waitFor(() => expect(client.listPlugins).toHaveBeenCalledTimes(1));
    emit({ type: "plugins_changed" });
    await vi.waitFor(() => expect(client.listPlugins).toHaveBeenCalledTimes(2));
    detach();
  });

  it("marks the sources that have an update available", async () => {
    attachFakeClient();
    await usePluginStore.getState().refresh();
    await usePluginStore.getState().checkUpdates();
    expect(usePluginStore.getState().updatable).toEqual(["npm:@foo/bar"]);
  });
});
