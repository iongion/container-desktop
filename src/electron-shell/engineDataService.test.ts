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

  it("publishes the engine version resolved by the connected host", async () => {
    const service = new EngineDataService();
    const capabilities = {
      resources: { pods: false, secrets: false },
      events: false,
      sort: {},
      extensions: {
        machines: false,
        kube: false,
        contexts: false,
        swarm: false,
        builders: false,
        compose: false,
        registries: false,
        controllerVersion: false,
      },
    };
    const host = {
      capabilities,
      getSettings: async () => ({
        api: { baseURL: "http://localhost", connection: { uri: "", relay: "" }, autoStart: true },
        program: { name: "docker", path: "/usr/bin/docker", version: "27.3.1" },
        rootfull: false,
        mode: "mode.automatic",
      }),
    } as unknown as HostClientFacade;
    (service as any).ensureApp = () => ({
      setup: async () => undefined,
      connectHostClient: async () => ({ host, availability: { api: true } }),
    });
    (service as any).refreshAll = async () => undefined;
    (service as any).loadMachines = async () => [];

    await service.connectOne({
      id: "system-default.docker",
      name: "System Docker",
      engine: ContainerEngine.DOCKER,
      host: "docker.native",
      settings: {
        api: { baseURL: "http://localhost", connection: { uri: "", relay: "" }, autoStart: true },
        program: { name: "docker", path: "", version: "" },
        rootfull: false,
        mode: "mode.automatic",
      },
    } as any);

    expect(service.getAppRuntimeSnapshot().active?.[0]?.version).toBe("27.3.1");
  });
});

describe("EngineDataService.performAction", () => {
  it("routes a container action to the containers adapter (POST .../stop)", async () => {
    const calls: string[] = [];
    const fakeHost = {
      ENGINE: ContainerEngine.PODMAN,
      getApiDriver: async () => ({
        post: async (url: string) => {
          calls.push(`POST ${url}`);
          return { status: 204 };
        },
        get: async () => ({ status: 200, data: [] }),
      }),
    } as unknown as HostClientFacade;
    const service = new EngineDataService();
    await service.performAction("container.stop", "c1", fakeHost);
    expect(calls).toContain("POST /containers/c1/stop");
  });

  it("routes a machine action to the host facade", async () => {
    const started: string[] = [];
    const fakeHost = {
      startPodmanMachine: async (name: string) => {
        started.push(name);
        return true;
      },
    } as unknown as HostClientFacade;
    const service = new EngineDataService();
    await service.performAction("machine.start", "pm-default", fakeHost);
    expect(started).toEqual(["pm-default"]);
  });

  it("rejects an unknown action kind", async () => {
    const service = new EngineDataService();
    await expect(service.performAction("bogus.kind", "x", {} as unknown as HostClientFacade)).rejects.toThrow();
  });
});

describe("EngineDataService auto-reconnect", () => {
  const conn = (id: string, autoReconnect?: boolean) =>
    ({ id, name: id, engine: ContainerEngine.PODMAN, settings: { api: { autoReconnect } } }) as any;

  it("does NOT reconnect a connection the user explicitly disconnected", () => {
    const service = new EngineDataService();
    const sched = vi.fn();
    (service as any).scheduleReconnect = sched;
    (service as any).connectionById.set("c1", conn("c1"));
    (service as any).userDisconnected.add("c1");
    (service as any).handleDrop("c1", "socket closed");
    expect(sched).not.toHaveBeenCalled();
  });

  it("marks a dropped connection 'reconnecting' and retries connectOne after the back-off", async () => {
    vi.useFakeTimers();
    const service = new EngineDataService();
    (service as any).resolveReconnectPolicy = async () => ({
      enabled: true,
      initialMs: 1000,
      maxMs: 30000,
      factor: 2,
    });
    const connectCalls: string[] = [];
    (service as any).connectOne = async (c: any) => {
      connectCalls.push(c.id);
    };
    (service as any).connectionById.set("c1", conn("c1"));
    (service as any).handleDrop("c1", "socket closed");
    await vi.advanceTimersByTimeAsync(0); // let scheduleReconnect's awaited policy resolve
    expect(service.getAppRuntimeSnapshot().active?.find((r) => r.id === "c1")?.phase).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(30000); // exceed the (jittered, ≤1s) attempt-1 delay
    expect(connectCalls).toEqual(["c1"]);
    vi.useRealTimers();
  });

  it("leaves a dropped connection 'failed' (no retry) when auto-reconnect is disabled", async () => {
    vi.useFakeTimers();
    const service = new EngineDataService();
    (service as any).resolveReconnectPolicy = async () => ({
      enabled: false,
      initialMs: 1000,
      maxMs: 30000,
      factor: 2,
    });
    const connectCalls: string[] = [];
    (service as any).connectOne = async (c: any) => {
      connectCalls.push(c.id);
    };
    (service as any).connectionById.set("c1", conn("c1"));
    (service as any).handleDrop("c1", "socket closed");
    await vi.advanceTimersByTimeAsync(0);
    expect(service.getAppRuntimeSnapshot().active?.find((r) => r.id === "c1")?.phase).toBe("failed");
    await vi.advanceTimersByTimeAsync(60000);
    expect(connectCalls).toEqual([]);
    vi.useRealTimers();
  });

  it("back-off is floored at 250ms and capped at maxMs", () => {
    const service = new EngineDataService();
    const policy = { initialMs: 1000, maxMs: 30000, factor: 2 };
    const rnd = vi.spyOn(Math, "random");
    rnd.mockReturnValue(0);
    expect((service as any).backoffDelay(1, policy)).toBe(250); // jitter 0 → floor
    rnd.mockReturnValue(0.999999);
    expect((service as any).backoffDelay(1, policy)).toBeLessThanOrEqual(1000); // attempt-1 base
    expect((service as any).backoffDelay(50, policy)).toBeLessThanOrEqual(30000); // capped at maxMs
    rnd.mockRestore();
  });
});

describe("EngineDataService.getMachines", () => {
  it("is empty by default and is refreshed (and notifies) after a machine action", async () => {
    const fakeHost = {
      capabilities: { extensions: { machines: true } },
      getPodmanMachines: async () => [{ Name: "podman-machine-default", Running: true }],
      startPodmanMachine: async () => true,
    } as unknown as HostClientFacade;
    const service = new EngineDataService();
    expect(service.getMachines()).toEqual([]);
    let changes = 0;
    service.subscribe(() => {
      changes += 1;
    });
    await service.performAction("machine.start", "podman-machine-default", fakeHost);
    expect(service.getMachines()).toEqual([{ name: "podman-machine-default", running: true }]);
    expect(changes).toBeGreaterThan(0); // menu rebuild trigger
  });
});
