import { EventEmitter } from "eventemitter3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type FakeCommandHandle, installFakeCommand } from "@/__tests__/setup/fakeCommand";
import { Application } from "@/container-client/Application";
import type { ResourceConnectProgress } from "@/container-client/resourceSyncProtocol";
import type { HostClientFacade } from "@/container-client/runtimes/facade";
import { ContainerEngine } from "@/container-client/types/engine";
import { __setLoggerLevelForTests, registerLoggerBackend } from "@/logger";
import { EngineDataService, pingUntilAvailable } from "@/platform/engineDataService";

describe("pingUntilAvailable", () => {
  const noSleep = async () => {};

  it("returns immediately when the first ping succeeds (no retries)", async () => {
    let calls = 0;
    const res = await pingUntilAvailable(
      async () => {
        calls += 1;
        return { success: true };
      },
      { attempts: 3, delayMs: 10, sleep: noSleep },
    );
    expect(res.success).toBe(true);
    expect(calls).toBe(1);
  });

  it("retries and recovers when a transient failure clears within the grace window", async () => {
    let calls = 0;
    const res = await pingUntilAvailable(
      async () => {
        calls += 1;
        return { success: calls >= 3 };
      },
      { attempts: 3, delayMs: 10, sleep: noSleep },
    );
    expect(res.success).toBe(true);
    expect(calls).toBe(3);
  });

  it("reports failure only after exhausting every attempt", async () => {
    let calls = 0;
    const res = await pingUntilAvailable(
      async () => {
        calls += 1;
        return { success: false };
      },
      { attempts: 3, delayMs: 10, sleep: noSleep },
    );
    expect(res.success).toBe(false);
    expect(calls).toBe(3);
  });

  it("treats a thrown ping (e.g. ECONNREFUSED) as a failed attempt and keeps retrying", async () => {
    let calls = 0;
    const res = await pingUntilAvailable(
      async () => {
        calls += 1;
        if (calls < 2) throw new Error("connect ECONNREFUSED");
        return { success: true };
      },
      { attempts: 3, delayMs: 10, sleep: noSleep },
    );
    expect(res.success).toBe(true);
    expect(calls).toBe(2);
  });
});

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
    expect(seen.length).toBe(1); // not notified after unsub
  });

  it("does not notify subscribers for unchanged resource snapshots", () => {
    const service = new EngineDataService();
    const seen: number[] = [];
    service.subscribe(() => seen.push(1));
    service.setResourceItems("conn-1", "containers", [{ Id: "a" } as any]);
    service.setResourceItems("conn-1", "containers", [{ Id: "a" } as any]);
    service.setResourceItems("conn-1", "containers", [{ Id: "b" } as any]);
    expect(seen).toHaveLength(2);
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

  it("skips unsupported domains for the target host", async () => {
    const fakeHost = {
      capabilities: { resources: { pods: false, secrets: false } },
      getApiDriver: vi.fn(),
    } as unknown as HostClientFacade;
    const service = new EngineDataService();
    await service.refresh("conn-1", "pods", fakeHost);
    expect((fakeHost as any).getApiDriver).not.toHaveBeenCalled();
    expect(service.getResourceState("conn-1").pods).toEqual([]);
  });

  it("demotes a ready connection and clears its resources when a refresh fails because the API is gone", async () => {
    const service = new EngineDataService();
    const connection = {
      id: "mac-docker",
      name: "MacOS (docker)",
      engine: ContainerEngine.DOCKER,
      host: "docker.remote",
      settings: { api: { autoReconnect: false } },
    } as any;
    const fakeHost = {
      capabilities: { resources: { pods: false, secrets: false, networks: true } },
      getApiDriver: async () => ({
        get: async () => {
          const error: any = new Error("timeout of 3000ms exceeded");
          error.code = "ECONNABORTED";
          throw error;
        },
      }),
      isApiRunning: vi.fn(async () => ({ success: false, details: "API is not reachable" })),
    } as unknown as HostClientFacade;
    (service as any).connectionById.set(connection.id, connection);
    (service as any).hostByConnection.set(connection.id, fakeHost);
    (service as any).runtimeByConnection.set(connection.id, {
      id: connection.id,
      name: connection.name,
      engine: connection.engine,
      phase: "ready",
      running: true,
    });
    service.setResourceItems(connection.id, "containers", [{ Id: "c1" } as any]);
    service.setResourceItems(connection.id, "images", [{ Id: "i1" } as any]);

    await expect(service.refresh(connection.id, "images", fakeHost)).rejects.toThrow("timeout");

    const runtime = service.getAppRuntimeSnapshot().active?.find((item) => item.id === connection.id);
    expect(runtime?.phase).toBe("failed");
    expect(runtime?.running).toBe(false);
    expect(runtime?.error).toBe("API is not reachable");
    expect(service.getResourceState(connection.id).containers).toEqual([]);
    expect(service.getResourceState(connection.id).images).toEqual([]);
  });
});

describe("EngineDataService.onEngineEvent", () => {
  const hostWithPods = (pods: boolean) =>
    ({
      capabilities: {
        resources: { pods, secrets: false },
      },
    }) as unknown as HostClientFacade;

  it("debounces and refreshes containers + pods for a container event", async () => {
    vi.useFakeTimers();
    const service = new EngineDataService();
    const refreshed: string[] = [];
    (service as any).refresh = async (_c: string, d: string) => {
      refreshed.push(d);
    };
    (service as any).hostByConnection.set("conn-1", hostWithPods(true));
    service.onEngineEvent("conn-1", { Type: "container", Action: "die" });
    service.onEngineEvent("conn-1", { Type: "container", Action: "die" }); // coalesced
    await vi.advanceTimersByTimeAsync(600);
    expect(refreshed.sort()).toEqual(["containers", "pods"]);
    vi.useRealTimers();
  });

  it("does not refresh Podman-only pods for Docker container events", async () => {
    vi.useFakeTimers();
    const service = new EngineDataService();
    const refreshed: string[] = [];
    (service as any).refresh = async (_c: string, d: string) => {
      refreshed.push(d);
    };
    (service as any).hostByConnection.set("conn-1", hostWithPods(false));
    service.onEngineEvent("conn-1", { Type: "container", Action: "die" });
    await vi.advanceTimersByTimeAsync(600);
    expect(refreshed).toEqual(["containers"]);
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

  it("emits an info shell.engine record when a connection becomes ready", async () => {
    const records: Array<{ level: string; scope: string; args: any[] }> = [];
    registerLoggerBackend({ write: (level, scope, args) => records.push({ level, scope, args }) });
    __setLoggerLevelForTests("debug");
    try {
      const service = new EngineDataService();
      const host = {
        capabilities: {
          resources: { pods: false, secrets: false },
          events: false,
          sort: {},
          extensions: { machines: false },
        },
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

      expect(records.some((r) => r.scope === "shell.engine" && r.level === "info")).toBe(true);
    } finally {
      registerLoggerBackend(null);
      __setLoggerLevelForTests("warn");
    }
  });

  it("connectAll starts boot connections concurrently and settles after the slowest one", async () => {
    vi.useFakeTimers();
    const service = new EngineDataService();
    const connection = (id: string) =>
      ({
        id,
        name: id,
        engine: ContainerEngine.DOCKER,
        host: "docker.native",
        settings: { api: { autoStart: true } },
      }) as any;
    const fast = connection("fast");
    const slow = connection("slow");
    let slowFinished = false;
    (service as any).ensureApp = () => ({
      setup: async () => undefined,
      getSystemConnections: async () => [fast, slow],
      getConnections: async () => [],
      getGlobalUserSettings: async () => ({ connector: { default: "fast" } }),
    });
    (service as any).connectOne = async (target: any) => {
      if (target.id === "slow") {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        slowFinished = true;
      }
      (service as any).runtimeByConnection.set(target.id, {
        id: target.id,
        name: target.name,
        engine: target.engine,
        phase: "ready",
        running: true,
      });
    };

    let settled = false;
    const connecting = service.connectAll().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(slowFinished).toBe(false);
    expect(service.getAppRuntimeSnapshot().active?.some((runtime) => runtime.id === "fast" && runtime.running)).toBe(
      true,
    );
    await vi.advanceTimersByTimeAsync(1000);
    await connecting;
    expect(settled).toBe(true);
    expect(slowFinished).toBe(true);
    vi.useRealTimers();
  });

  it("does not block a ready connection forever on resource warmup", async () => {
    vi.useFakeTimers();
    const service = new EngineDataService();
    const capabilities = {
      resources: { pods: false, secrets: false, networks: true },
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
    (service as any).refreshAll = async () => new Promise<never>(() => undefined);

    const connecting = service.connectOne({
      id: "slow-resources",
      name: "slow-resources",
      engine: ContainerEngine.DOCKER,
      host: "docker.native",
      settings: {
        api: { baseURL: "http://localhost", connection: { uri: "", relay: "" }, autoStart: true },
        program: { name: "docker", path: "", version: "" },
        rootfull: false,
        mode: "mode.automatic",
      },
    } as any);
    await vi.advanceTimersByTimeAsync(5000);
    await connecting;

    const runtime = service.getAppRuntimeSnapshot().active?.find((item) => item.id === "slow-resources");
    expect(runtime?.phase).toBe("ready");
    expect(runtime?.running).toBe(true);
    vi.useRealTimers();
  });

  it("tags a boot/auto-start failure 'bootstrap' and surfaces the REAL reason + detail (not 'Not checked')", async () => {
    const service = new EngineDataService();
    const unavailable = {
      id: "system-env.mac.container",
      name: "MacOS (container)",
      engine: ContainerEngine.APPLE,
      host: "container.remote",
      settings: { api: { autoStart: true }, controller: { scope: "MacOS" } },
    } as any;
    // connectHostClient surfaces the SSH failure: it folds the real reason + raw preflight detail into
    // availability.report (api + detail). connectOne must surface those, not the "Not checked" placeholder.
    (service as any).ensureApp = () => ({
      setup: async () => undefined,
      connectHostClient: async () => ({
        host: undefined,
        availability: {
          api: false,
          report: {
            api: "ssh: connect to host 192.168.0.33 port 22: No route to host",
            detail: "SSH preflight:\n  ✗ host reachable — No route to host",
          },
        },
      }),
    });
    const progress: ResourceConnectProgress[] = [];
    service.subscribeProgress((p) => progress.push(p));
    await service.connectOne(unavailable); // default origin = bootstrap (the connectAll path)
    const failed = progress.find((p) => p.phase === "failed");
    expect(failed?.origin).toBe("bootstrap");
    expect(failed?.trace).toContain("No route to host"); // the REAL reason, never the placeholder
    expect(failed?.detail).toContain("What it tried:"); // what was attempted
    expect(failed?.detail).toContain("via SSH (MacOS)");
    expect(failed?.detail).toContain("No route to host"); // what happened
  });

  it("tags an explicit user connect failure 'user' and carries the real reason + detail", async () => {
    const service = new EngineDataService();
    const target = {
      id: "system-default.docker",
      name: "MacOS (docker)",
      engine: ContainerEngine.DOCKER,
      host: "docker.native",
      settings: { api: { autoStart: true } },
    } as any;
    (service as any).ensureApp = () => ({
      setup: async () => undefined,
      getGlobalUserSettings: async () => ({ connector: { default: target.id } }),
      connectHostClient: async () => ({
        host: undefined,
        availability: {
          api: false,
          report: { api: "Cannot connect to the Docker daemon at unix:///var/run/docker.sock" },
        },
      }),
    });
    (service as any).loadConnections = async () => [target];
    const progress: ResourceConnectProgress[] = [];
    service.subscribeProgress((p) => progress.push(p));
    await service.ensureConnected(target.id); // explicit connect intent
    const failed = progress.find((p) => p.phase === "failed");
    expect(failed?.origin).toBe("user");
    expect(failed?.trace).toContain("Cannot connect to the Docker daemon");
    expect(failed?.detail).toContain("What it tried:");
  });

  it("surfaces the real API failure, not a passing host check's success message", async () => {
    const service = new EngineDataService();
    const target = {
      id: "system-env.mac.container",
      name: "MacOS (container)",
      engine: ContainerEngine.APPLE,
      host: "container.remote",
      settings: { api: { autoStart: true }, controller: { scope: "MacOS" } },
    } as any;
    // Mirrors the real Apple-container case: the host binary is present (host:true / "Engine is available")
    // but the API daemon isn't serving (api:false). The surfaced reason must be the API failure, NOT the
    // passing host check's success string.
    (service as any).ensureApp = () => ({
      setup: async () => undefined,
      getGlobalUserSettings: async () => ({ connector: { default: target.id } }),
      connectHostClient: async () => ({
        host: undefined,
        availability: {
          enabled: true,
          host: true,
          controller: false,
          program: false,
          api: false,
          report: {
            host: "Engine is available",
            controller: 'Controller "ssh" was not detected on this machine',
            program: "Not checked - controller scope not available",
            api: "API is not reachable - start manually or connect",
          },
        },
      }),
    });
    (service as any).loadConnections = async () => [target];
    const progress: ResourceConnectProgress[] = [];
    service.subscribeProgress((p) => progress.push(p));
    await service.connectOne(target);
    const failed = progress.find((p) => p.phase === "failed");
    expect(failed?.trace).toContain("API is not reachable");
    expect(failed?.trace).not.toContain("Engine is available");
  });
});

describe("EngineDataService.ensureApp (realm-aware)", () => {
  afterEach(() => {
    (Application as any).instance = undefined;
  });

  // Under Tauri the engine service runs in the SAME realm as the renderer (no main process), so it must
  // reuse the renderer-owned Application singleton (getInstance) rather than re-minting one via
  // initInstance — which reads process.env (undefined in a webview) AND would stomp the renderer's
  // instance. The jsdom test env has `window` defined, so it stands in for that webview realm.
  it("reuses the renderer's Application singleton in a webview realm instead of stomping it", () => {
    (Application as any).instance = undefined;
    const rendererSingleton = Application.getInstance();
    const service = new EngineDataService();
    expect((service as any).ensureApp()).toBe(rendererSingleton);
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

describe("EngineDataService.probeMounts", () => {
  const originalMockMode = process.env.CONTAINER_DESKTOP_MOCK;

  afterEach(() => {
    if (originalMockMode === undefined) {
      delete process.env.CONTAINER_DESKTOP_MOCK;
    } else {
      process.env.CONTAINER_DESKTOP_MOCK = originalMockMode;
    }
    vi.useRealTimers();
  });

  it("probes cached mount source paths through the mount's connection host", async () => {
    const service = new EngineDataService();
    service.setResourceItems("conn-1", "containers", [
      {
        Id: "container-1",
        Names: ["/api-1"],
        Computed: { Name: "api-1" },
        Mounts: [{ Type: "bind", Source: "/srv/api", Destination: "/app", Mode: "rw", RW: true }],
      } as any,
    ]);
    const calls: Array<{ program: string; args: string[] }> = [];
    (service as any).hostByConnection.set("conn-1", {
      isScoped: () => false,
      runHostCommand: async (program: string, args: string[]) => {
        calls.push({ program, args });
        return { success: true, stdout: "ext4\n", stderr: "", code: 0 };
      },
    });

    const response = await (service as any).probeMounts();

    expect(calls).toHaveLength(1);
    expect(calls[0].program).toBe("sh");
    expect(calls[0].args.join(" ")).toContain("/srv/api");
    expect(response.results).toEqual([
      expect.objectContaining({
        connectionId: "conn-1",
        containerId: "container-1",
        source: "/srv/api",
        destination: "/app",
        backend: "ext4",
        healthy: true,
      }),
    ]);
    expect(response.results[0].latencyMs).toEqual(expect.any(Number));
  });

  it("keeps mock mount probes on the backend path with a realistic delay", async () => {
    vi.useFakeTimers();
    process.env.CONTAINER_DESKTOP_MOCK = "1";
    const service = new EngineDataService();
    service.setResourceItems("conn-1", "containers", [
      {
        Id: "container-1",
        Names: ["/api-1"],
        Computed: { Name: "api-1" },
        Mounts: [{ Type: "bind", Source: "/srv/api", Destination: "/app", Mode: "rw", RW: true }],
      } as any,
    ]);
    let settled = false;
    const probing = service.probeMounts().then((response) => {
      settled = true;
      return response;
    });

    await vi.advanceTimersByTimeAsync(2199);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(probing).resolves.toEqual({
      results: [
        expect.objectContaining({
          backend: "host bind",
          healthy: true,
          latencyMs: 8,
        }),
      ],
    });
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

  it("keeps a connection ready when only the events stream aborts and the API is still reachable", async () => {
    vi.useFakeTimers();
    const service = new EngineDataService();
    const firstStream = new EventEmitter();
    const secondStream = new EventEmitter();
    const streams = [firstStream, secondStream];
    const getEventsStream = vi.fn(async () => streams.shift());
    const host = {
      getEventsStream,
      isApiRunning: vi.fn(async () => ({ success: true, details: "Api is reachable" })),
    } as unknown as HostClientFacade;
    const reconnect = vi.fn();
    (service as any).scheduleReconnect = reconnect;
    (service as any).connectionById.set("c1", conn("c1"));
    (service as any).hostByConnection.set("c1", host);
    (service as any).runtimeByConnection.set("c1", {
      id: "c1",
      name: "c1",
      engine: ContainerEngine.DOCKER,
      phase: "ready",
      running: true,
    });

    const stop = await (service as any).connectEvents("c1", host);
    (service as any).stopEventsByConnection.set("c1", stop);
    await vi.advanceTimersByTimeAsync(2000);
    firstStream.emit("error", new Error("aborted"));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const runtime = service.getAppRuntimeSnapshot().active?.find((r) => r.id === "c1");
    expect(getEventsStream).toHaveBeenCalledTimes(2);
    expect(runtime?.phase).toBe("ready");
    expect(runtime?.running).toBe(true);
    expect(reconnect).not.toHaveBeenCalled();
    expect((service as any).hostByConnection.get("c1")).toBe(host);
    vi.useRealTimers();
  });

  it("does not block connection startup when an events stream never opens", async () => {
    vi.useFakeTimers();
    const service = new EngineDataService();
    const getEventsStream = vi.fn(() => new Promise<never>(() => undefined));
    const host = { getEventsStream } as unknown as HostClientFacade;

    const opening = (service as any).connectEvents("c1", host);
    await vi.advanceTimersByTimeAsync(4000);
    const stop = await opening;

    expect(typeof stop).toBe("function");
    expect(getEventsStream).toHaveBeenCalledWith(expect.objectContaining({ attachTimeoutMs: 3000 }));
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
