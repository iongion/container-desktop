import { describe, expect, it } from "vitest";

import { RESOURCE_SYNC, type ResourceSyncSnapshot } from "@/container-client/resourceSyncProtocol";
import { ResourceSyncBroker } from "./resourceSyncBroker";

const snap: ResourceSyncSnapshot = {
  appRuntime: { phase: "ready", running: true, osType: "Linux", connections: [] },
  resources: {},
};

function makeDeps() {
  let changeCb = () => {};
  const invokeHandlers = new Map<string, (event: any) => unknown>();
  const messageHandlers = new Map<string, (event: any, payload: any) => void>();
  const broadcasts: Array<{ channel: string; payload: unknown }> = [];
  const refreshed: Array<{ connectionId: string; domain: string }> = [];
  const started: Array<string | undefined> = [];
  return {
    service: {
      getSyncSnapshot: () => snap,
      subscribe: (cb: () => void) => {
        changeCb = cb;
        return () => {};
      },
      refresh: async (connectionId: string, domain: any) => {
        refreshed.push({ connectionId, domain });
      },
      start: async (targetConnectionId?: string) => {
        started.push(targetConnectionId);
      },
    },
    onInvoke: (channel: string, handler: (event: any) => unknown) => invokeHandlers.set(channel, handler),
    onMessage: (channel: string, handler: (event: any, payload: any) => void) => messageHandlers.set(channel, handler),
    broadcast: (channel: string, payload: unknown) => broadcasts.push({ channel, payload }),
    isAllowedSender: (event: any) => event?.allowed === true,
    _fireChange: () => changeCb(),
    _invoke: (channel: string, event: any) => invokeHandlers.get(channel)?.(event),
    _message: (channel: string, event: any, payload: any) => messageHandlers.get(channel)?.(event, payload),
    _broadcasts: () => broadcasts,
    _refreshed: () => refreshed,
    _started: () => started,
  };
}

describe("ResourceSyncBroker", () => {
  it("pushes a snapshot to all windows when the service changes", () => {
    const deps = makeDeps();
    new ResourceSyncBroker(deps).register();
    deps._fireChange();
    expect(deps._broadcasts()).toEqual([{ channel: RESOURCE_SYNC.snapshot, payload: snap }]);
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

  it("routes a switch-connection request to service.start for an allowed sender only", () => {
    const deps = makeDeps();
    new ResourceSyncBroker(deps).register();
    deps._message(RESOURCE_SYNC.switchConnection, { allowed: false }, { connectionId: "c2" });
    deps._message(RESOURCE_SYNC.switchConnection, { allowed: true }, { connectionId: "c2" });
    expect(deps._started()).toEqual(["c2"]);
  });
});
