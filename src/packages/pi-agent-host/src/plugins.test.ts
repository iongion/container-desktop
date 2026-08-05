import { describe, expect, it, vi } from "vitest";

import { createPluginService, type PiPackageSource } from "@/pi-agent-host/plugins";
import type { BridgeEvent } from "@/pi-bridge/protocol";

function harness(packages: PiPackageSource[] = ["npm:@foo/bar"]) {
  const events: BridgeEvent[] = [];
  const state = { global: [...packages], project: [] as PiPackageSource[] };
  const packageManager = {
    installAndPersist: vi.fn(async () => {}),
    removeAndPersist: vi.fn(async () => true),
    update: vi.fn(async () => {}),
    listConfiguredPackages: vi.fn(() =>
      state.global.map((entry) => ({
        source: typeof entry === "string" ? entry : entry.source,
        scope: "user" as const,
        filtered: typeof entry === "object",
        installedPath: "/pkgs/bar",
      })),
    ),
    addSourceToSettings: vi.fn(() => true),
    removeSourceFromSettings: vi.fn(() => true),
    setProgressCallback: vi.fn(),
    checkForAvailableUpdates: vi.fn(async () => [
      { source: "npm:@foo/bar", displayName: "@foo/bar", type: "npm" as const, scope: "user" as const },
    ]),
  };
  const settings = {
    getGlobalSettings: vi.fn(() => ({ packages: state.global })),
    getProjectSettings: vi.fn(() => ({ packages: state.project })),
    setPackages: vi.fn((next: PiPackageSource[]) => {
      state.global = next;
    }),
    setProjectPackages: vi.fn((next: PiPackageSource[]) => {
      state.project = next;
    }),
    flush: vi.fn(async () => {}),
  };
  const service = createPluginService({
    packageManager: packageManager as never,
    settings: settings as never,
    emit: (event) => events.push(event),
  });
  return { service, packageManager, settings, events, state };
}

describe("createPluginService", () => {
  it("lists configured packages with their enabled state", () => {
    const { service } = harness();
    const payload = service.list();
    expect(payload.configured).toEqual([
      { source: "npm:@foo/bar", scope: "user", filtered: false, installedPath: "/pkgs/bar" },
    ]);
  });

  // pi's listConfiguredPackages flattens the object form to `filtered: true` and loses autoload, so the
  // service reads it back off the raw settings entry — that flag is the whole disabled/enabled signal.
  it("reports autoload off from the settings entry", () => {
    const { service } = harness([{ source: "npm:@foo/bar", autoload: false }]);
    expect(service.list().configured[0]).toMatchObject({ autoload: false, filtered: true });
  });

  it("installs through installAndPersist and announces the change", async () => {
    const { service, packageManager, events } = harness();
    await service.install("npm:@foo/baz", "user");
    expect(packageManager.installAndPersist).toHaveBeenCalledWith("npm:@foo/baz", { local: false });
    expect(events.at(-1)).toEqual({ type: "plugins_changed" });
  });

  it("installs a project-scoped source with local: true", async () => {
    const { service, packageManager } = harness();
    await service.install("npm:@foo/baz", "project");
    expect(packageManager.installAndPersist).toHaveBeenCalledWith("npm:@foo/baz", { local: true });
  });

  it("removes through removeAndPersist", async () => {
    const { service, packageManager, events } = harness();
    await service.remove("npm:@foo/bar", "user");
    expect(packageManager.removeAndPersist).toHaveBeenCalledWith("npm:@foo/bar", { local: false });
    expect(events.at(-1)).toEqual({ type: "plugins_changed" });
  });

  it("updates every package when no source is given", async () => {
    const { service, packageManager } = harness();
    await service.update();
    expect(packageManager.update).toHaveBeenCalledWith(undefined);
  });

  // Disabling must NOT drop the source: listConfiguredPackages reads settings.packages, so a removed entry
  // disappears from the table altogether and can never be re-enabled.
  it("disables by setting autoload off, keeping the entry and the install", async () => {
    const { service, settings, state, packageManager } = harness();
    await service.setEnabled("npm:@foo/bar", false, "user");
    expect(state.global).toEqual([{ source: "npm:@foo/bar", autoload: false }]);
    expect(packageManager.removeAndPersist).not.toHaveBeenCalled();
    expect(packageManager.removeSourceFromSettings).not.toHaveBeenCalled();
    expect(settings.flush).toHaveBeenCalled();
  });

  it("enables by collapsing the entry back to its plain source", async () => {
    const { service, state } = harness([{ source: "npm:@foo/bar", autoload: false }]);
    await service.setEnabled("npm:@foo/bar", true, "user");
    expect(state.global).toEqual(["npm:@foo/bar"]);
  });

  it("keeps a resource filter intact across a disable and enable round trip", async () => {
    const { service, state } = harness([{ source: "npm:@foo/bar", skills: ["search"] }]);
    await service.setEnabled("npm:@foo/bar", false, "user");
    expect(state.global).toEqual([{ source: "npm:@foo/bar", skills: ["search"], autoload: false }]);
    await service.setEnabled("npm:@foo/bar", true, "user");
    expect(state.global).toEqual([{ source: "npm:@foo/bar", skills: ["search"] }]);
  });

  it("writes a project-scoped toggle to the project packages", async () => {
    const { service, state, settings } = harness();
    state.project = ["npm:@foo/proj"];
    await service.setEnabled("npm:@foo/proj", false, "project");
    expect(settings.setProjectPackages).toHaveBeenCalledWith([{ source: "npm:@foo/proj", autoload: false }]);
    expect(settings.setPackages).not.toHaveBeenCalled();
  });

  it("refuses to toggle a source it has no entry for", async () => {
    const { service } = harness();
    await expect(service.setEnabled("npm:@foo/missing", false, "user")).rejects.toThrow(/npm:@foo\/missing/);
  });

  it("announces the change once a toggle is persisted", async () => {
    const { service, events } = harness();
    await service.setEnabled("npm:@foo/bar", false, "user");
    expect(events).toEqual([{ type: "plugins_changed" }]);
  });

  it("relays install progress as plugin_progress events", async () => {
    const { service, packageManager, events } = harness();
    await service.install("npm:@foo/baz", "user");
    const callback = packageManager.setProgressCallback.mock.calls[0][0] as (event: unknown) => void;
    callback({ type: "progress", action: "install", source: "npm:@foo/baz", message: "fetching" });
    expect(events).toContainEqual({
      type: "plugin_progress",
      source: "npm:@foo/baz",
      action: "install",
      phase: "progress",
      message: "fetching",
    });
  });

  it("clears the progress callback when the operation finishes, including on failure", async () => {
    const { service, packageManager } = harness();
    packageManager.installAndPersist.mockRejectedValueOnce(new Error("registry down"));
    await expect(service.install("npm:@foo/baz", "user")).rejects.toThrow("registry down");
    expect(packageManager.setProgressCallback).toHaveBeenLastCalledWith(undefined);
  });

  it("does not announce a change when the operation failed", async () => {
    const { service, packageManager, events } = harness();
    packageManager.installAndPersist.mockRejectedValueOnce(new Error("registry down"));
    await expect(service.install("npm:@foo/baz", "user")).rejects.toThrow("registry down");
    expect(events.some((event) => event.type === "plugins_changed")).toBe(false);
  });

  it("reports the sources with an update available", async () => {
    const { service } = harness();
    expect(await service.checkUpdates()).toEqual(["npm:@foo/bar"]);
  });
});
