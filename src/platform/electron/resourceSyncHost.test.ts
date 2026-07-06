import { describe, expect, it, vi } from "vitest";
import { RESOURCE_SYNC, type ResourceSyncSnapshot } from "@/container-client/resourceSyncProtocol";
import { createResourceSyncHost } from "./resourceSyncHost";

const snapshot: ResourceSyncSnapshot = {
  appRuntime: { phase: "ready", running: true, osType: "Linux", connections: [] },
  resources: {},
};

describe("createResourceSyncHost", () => {
  it("hosts ResourceSyncBroker registration around the main-owned service", () => {
    const invokeHandlers = new Map<string, (event: any, payload: any) => unknown>();
    const service = {
      getSyncSnapshot: vi.fn(() => snapshot),
      subscribe: vi.fn(() => () => undefined),
      refresh: vi.fn(),
      ensureConnected: vi.fn(),
    } as any;

    const host = createResourceSyncHost({
      service,
      onInvoke: (channel, handler) => invokeHandlers.set(channel, handler),
      onMessage: vi.fn(),
      broadcast: vi.fn(),
      isAllowedSender: () => true,
    });

    expect(host.service).toBe(service);
    expect(invokeHandlers.get(RESOURCE_SYNC.getSnapshot)?.({}, undefined)).toBe(snapshot);
  });
});
