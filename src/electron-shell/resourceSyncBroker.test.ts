import { describe, expect, it } from "vitest";

import { RESOURCE_SYNC, type ResourceSyncSnapshot } from "@/container-client/resourceSyncProtocol";
import { ResourceSyncBroker } from "./resourceSyncBroker";

const snap: ResourceSyncSnapshot = {
  appRuntime: { phase: "ready", running: true, osType: "Linux", connections: [] },
  resources: {},
};

function makeDeps() {
  let changeCb = () => {};
  let currentSnapshot = snap;
  const invokeHandlers = new Map<string, (event: any, payload: any) => unknown>();
  const messageHandlers = new Map<string, (event: any, payload: any) => void>();
  const broadcasts: Array<{ channel: string; payload: unknown }> = [];
  const refreshed: Array<{ connectionId: string; domain: string }> = [];
  const ensured: Array<string | undefined> = [];
  return {
    service: {
      getSyncSnapshot: () => currentSnapshot,
      subscribe: (cb: () => void) => {
        changeCb = cb;
        return () => {};
      },
      refresh: async (connectionId: string, domain: any) => {
        refreshed.push({ connectionId, domain });
      },
      ensureConnected: async (targetConnectionId?: string) => {
        ensured.push(targetConnectionId);
      },
    },
    onInvoke: (channel: string, handler: (event: any, payload: any) => unknown) => invokeHandlers.set(channel, handler),
    onMessage: (channel: string, handler: (event: any, payload: any) => void) => messageHandlers.set(channel, handler),
    broadcast: (channel: string, payload: unknown) => broadcasts.push({ channel, payload }),
    isAllowedSender: (event: any) => event?.allowed === true,
    _fireChange: () => changeCb(),
    _setSnapshot: (next: ResourceSyncSnapshot) => {
      currentSnapshot = next;
    },
    _invoke: (channel: string, event: any, payload?: any) => invokeHandlers.get(channel)?.(event, payload),
    _message: (channel: string, event: any, payload: any) => messageHandlers.get(channel)?.(event, payload),
    _broadcasts: () => broadcasts,
    _refreshed: () => refreshed,
    _ensured: () => ensured,
  };
}

async function flushSnapshotQueue() {
  await Promise.resolve();
}

describe("ResourceSyncBroker", () => {
  it("pushes a snapshot to all windows when the service changes", async () => {
    const deps = makeDeps();
    new ResourceSyncBroker(deps).register();
    deps._fireChange();
    expect(deps._broadcasts()).toEqual([]);
    await flushSnapshotQueue();
    expect(deps._broadcasts()).toEqual([{ channel: RESOURCE_SYNC.snapshot, payload: snap }]);
  });

  it("coalesces duplicate snapshot pushes", async () => {
    const deps = makeDeps();
    new ResourceSyncBroker(deps).register();

    deps._fireChange();
    deps._fireChange();
    await flushSnapshotQueue();
    expect(deps._broadcasts()).toHaveLength(1);

    deps._fireChange();
    await flushSnapshotQueue();
    expect(deps._broadcasts()).toHaveLength(1);

    const next = { ...snap, appRuntime: { ...snap.appRuntime, phase: "failed" as const, running: false } };
    deps._setSnapshot(next);
    deps._fireChange();
    await flushSnapshotQueue();
    expect(deps._broadcasts()).toEqual([
      { channel: RESOURCE_SYNC.snapshot, payload: snap },
      { channel: RESOURCE_SYNC.snapshot, payload: next },
    ]);
  });

  it("answers get-snapshot for an allowed sender and rejects others", () => {
    const deps = makeDeps();
    new ResourceSyncBroker(deps).register();
    expect(deps._invoke(RESOURCE_SYNC.getSnapshot, { allowed: true })).toEqual(snap);
    expect(deps._invoke(RESOURCE_SYNC.getSnapshot, { allowed: false })).toBeNull();
  });

  it("routes a refresh nudge to the service for an allowed sender only", () => {
    const deps = makeDeps();
    new ResourceSyncBroker(deps).register();
    deps._message(RESOURCE_SYNC.refresh, { allowed: false }, { connectionId: "c1", domains: ["containers"] });
    expect(deps._refreshed()).toEqual([]);
    deps._message(RESOURCE_SYNC.refresh, { allowed: true }, { connectionId: "c1", domains: ["containers", "pods"] });
    expect(deps._refreshed()).toEqual([
      { connectionId: "c1", domain: "containers" },
      { connectionId: "c1", domain: "pods" },
    ]);
  });

  it("routes ensure-connected to service.ensureConnected for an allowed sender only", async () => {
    const deps = makeDeps();
    new ResourceSyncBroker(deps).register();
    expect(await deps._invoke(RESOURCE_SYNC.ensureConnected, { allowed: false }, { connectionId: "c3" })).toBe(false);
    expect(await deps._invoke(RESOURCE_SYNC.ensureConnected, { allowed: true }, { connectionId: "c3" })).toBe(true);
    expect(deps._ensured()).toEqual(["c3"]);
  });
});
