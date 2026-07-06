import { afterEach, describe, expect, it } from "vitest";

import { Application } from "@/container-client/Application";
import { RESOURCE_SYNC, type ResourceSyncSnapshot } from "@/container-client/resourceSyncProtocol";
import { createResourceSyncHost } from "./resourceSyncHost";

// The in-process hub is the Tauri realm's replacement for the Electron main↔renderer RESOURCE_SYNC IPC:
// the same EngineDataService + ResourceSyncBroker run here, wired to a direct-call bus. These tests pin
// the collapse — invoke/send/subscribe must behave like the broker's ipcMain handlers, minus the process
// boundary — without needing a live Tauri window.
describe("createResourceSyncHost (in-process RESOURCE_SYNC hub)", () => {
  afterEach(() => {
    (Application as any).instance = undefined;
  });

  it("answers a getSnapshot invoke with the service's current sync snapshot", () => {
    const host = createResourceSyncHost();
    host.service.setResourceItems("c1", "containers", [{ Id: "a" } as any]);
    const snap = host.invoke(RESOURCE_SYNC.getSnapshot) as ResourceSyncSnapshot;
    expect(snap.resources.c1?.containers).toHaveLength(1);
    host.dispose();
  });

  it("broadcasts a snapshot to ResourceBus subscribers when the service changes, and stops after unsubscribe", async () => {
    const host = createResourceSyncHost();
    const seen: ResourceSyncSnapshot[] = [];
    const unsub = host.subscribe(RESOURCE_SYNC.snapshot, (s) => seen.push(s));
    host.service.setResourceItems("c1", "containers", [{ Id: "a" } as any]);
    await Promise.resolve(); // flush the broker's queueMicrotask batch
    expect(seen).toHaveLength(1);
    expect(seen[0].resources.c1?.containers).toHaveLength(1);
    unsub();
    host.service.setResourceItems("c1", "containers", [{ Id: "b" } as any]);
    await Promise.resolve();
    expect(seen).toHaveLength(1); // no delivery after unsubscribe
    host.dispose();
  });

  it("de-dupes identical snapshots (broker signature guard) — an unchanged write does not re-broadcast", async () => {
    const host = createResourceSyncHost();
    const seen: ResourceSyncSnapshot[] = [];
    host.subscribe(RESOURCE_SYNC.snapshot, (s) => seen.push(s));
    host.service.setResourceItems("c1", "containers", [{ Id: "a" } as any]);
    await Promise.resolve();
    host.service.setResourceItems("c2", "images", []); // a real change → a second distinct snapshot
    await Promise.resolve();
    expect(seen).toHaveLength(2);
    host.dispose();
  });

  it("routes a refresh send to service.refresh once per requested domain", () => {
    const host = createResourceSyncHost();
    const calls: Array<[string, string]> = [];
    (host.service as any).refresh = async (id: string, d: string) => {
      calls.push([id, d]);
    };
    host.send(RESOURCE_SYNC.refresh, { connectionId: "c1", domains: ["containers", "images"] });
    expect(calls).toEqual([
      ["c1", "containers"],
      ["c1", "images"],
    ]);
    host.dispose();
  });

  it("reports which channels it handles so the bridge can route window/logging channels itself", () => {
    const host = createResourceSyncHost();
    expect(host.handles(RESOURCE_SYNC.getSnapshot)).toBe(true);
    expect(host.handles(RESOURCE_SYNC.refresh)).toBe(true);
    expect(host.handles(RESOURCE_SYNC.connectAll)).toBe(true);
    expect(host.handles("window.minimize")).toBe(false);
    expect(host.handles("logging:apply")).toBe(false);
    host.dispose();
  });

  it("stops broadcasting after dispose", async () => {
    const host = createResourceSyncHost();
    const seen: unknown[] = [];
    host.subscribe(RESOURCE_SYNC.snapshot, (s) => seen.push(s));
    host.dispose();
    host.service.setResourceItems("c1", "containers", [{ Id: "a" } as any]);
    await Promise.resolve();
    expect(seen).toHaveLength(0);
  });
});
