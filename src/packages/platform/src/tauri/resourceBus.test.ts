import { describe, expect, it, vi } from "vitest";
import { RESOURCE_SYNC } from "@/container-client/resourceSyncProtocol";
import { createTauriResourceBus } from "./resourceBus";

describe("createTauriResourceBus", () => {
  it("subscribes to resource-sync push channels through the in-realm resource host", () => {
    const unsubscribe = vi.fn();
    const host = { subscribe: vi.fn(() => unsubscribe) };
    const bus = createTauriResourceBus(host);
    const callback = vi.fn();

    const off = bus.subscribe(RESOURCE_SYNC.snapshot, callback);

    expect(host.subscribe).toHaveBeenCalledWith(RESOURCE_SYNC.snapshot, callback);
    expect(off).toBe(unsubscribe);
  });

  it("keeps the same allowlist as the Electron ResourceBus", () => {
    const bus = createTauriResourceBus({ subscribe: vi.fn() });
    expect(() => bus.subscribe("unknown", vi.fn())).toThrow("ResourceBus: subscribe not allowed");
  });
});
