import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type FakeCommandHandle, installFakeCommand } from "@/__tests__/setup/fakeCommand";
import { Application } from "@/container-client/Application";
import type { HostClientFacade } from "@/container-client/runtimes/facade";
import { ContainerEngine } from "@/env/Types";
import { EngineDataService } from "./engineDataService";

describe("EngineDataService state", () => {
  it("starts empty and notifies subscribers on change", () => {
    const service = new EngineDataService();
    const seen: number[] = [];
    const unsub = service.subscribe(() => seen.push(1));
    expect(service.getResourceState("conn-1").containers).toEqual([]);
    service.setResourceItems("conn-1", "containers", [{ Id: "a" } as any]);
    expect(service.getResourceState("conn-1").containers).toEqual([{ Id: "a" }]);
    expect(seen.length).toBe(1);
    unsub();
    service.setResourceItems("conn-1", "containers", []);
    expect(seen.length).toBe(1); // no longer notified after unsub
  });
});

describe("EngineDataService.refresh", () => {
  it("loads a domain through an injected host and stores normalized items", async () => {
    const fakeHost = {
      ENGINE: ContainerEngine.PODMAN,
      getApiDriver: async () => ({
        get: async () => ({
          status: 200,
          data: [{ Id: "c1", Names: ["/web-1"], Image: "img", State: "running" }],
        }),
      }),
    } as unknown as HostClientFacade;
    const service = new EngineDataService();
    await service.refresh("conn-1", "containers", fakeHost);
    const containers = service.getResourceState("conn-1").containers;
    expect(containers).toHaveLength(1);
    expect((containers[0] as any).Computed?.Name).toBe("web-1"); // normalizer ran
  });
});

describe("EngineDataService.onEngineEvent", () => {
  it("debounces and refreshes containers + pods for a container event", async () => {
    vi.useFakeTimers();
    const service = new EngineDataService();
    const refreshed: string[] = [];
    (service as any).refresh = async (_c: string, d: string) => {
      refreshed.push(d);
    };
    service.onEngineEvent("conn-1", { Type: "container", Action: "die" });
    service.onEngineEvent("conn-1", { Type: "container", Action: "die" }); // coalesced
    await vi.advanceTimersByTimeAsync(600);
    expect(refreshed.sort()).toEqual(["containers", "pods"]);
    vi.useRealTimers();
  });
});

describe("EngineDataService.connect", () => {
  let fake: FakeCommandHandle;
  beforeEach(() => {
    fake = installFakeCommand();
  });
  afterEach(() => {
    fake.restore();
    (Application as any).instance = undefined;
  });

  it("connects without throwing and exposes an app/runtime snapshot", async () => {
    const service = new EngineDataService();
    await service.connect();
    const snap = service.getAppRuntimeSnapshot();
    expect(["ready", "failed"]).toContain(snap.phase);
    expect(typeof snap.osType).toBe("string");
    expect(Array.isArray(snap.connections)).toBe(true);
  });
});
