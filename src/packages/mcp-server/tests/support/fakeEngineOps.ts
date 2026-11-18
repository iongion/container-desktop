import { vi } from "vitest";
import type { EngineContainer, EngineOps } from "@/container-client/engineOps";

// An in-memory engine with one running container, `web`. Lifecycle calls change its state, so a test can read back
// what a call did; any method can be replaced through `overrides`.
export function fakeEngineOps(overrides: Partial<EngineOps> = {}): EngineOps {
  const web: EngineContainer = { Id: "web", Name: "web", Image: "nginx", State: "running" };
  const setState = (state: string) => async () => {
    web.State = state;
    return true;
  };
  const ops: EngineOps = {
    listConnections: vi.fn(() => [{ id: "podman", name: "Podman", engine: "podman", running: true }]),
    listContainers: vi.fn(async () => [web]),
    inspectContainer: vi.fn(async ({ id }) => (id === web.Id ? web : undefined)),
    getContainerLogs: vi.fn(async () => "line 1\nline 2"),
    getContainerStats: vi.fn(async () => ({ name: "web", memory_stats: { usage: 1, limit: 2 } })),
    startContainer: vi.fn(setState("running")),
    stopContainer: vi.fn(setState("exited")),
    restartContainer: vi.fn(setState("running")),
    pauseContainer: vi.fn(setState("paused")),
    unpauseContainer: vi.fn(setState("running")),
    removeContainer: vi.fn(async () => true),
    listImages: vi.fn(async () => [{ Id: "sha256:1", Name: "nginx" }]),
    inspectImage: vi.fn(async () => ({ Id: "sha256:1", Name: "nginx" })),
    pullImage: vi.fn(async () => true),
    removeImage: vi.fn(async () => true),
    listNetworks: vi.fn(async () => [{ id: "n1", name: "bridge" }]),
    inspectNetwork: vi.fn(async () => ({ id: "n1", name: "bridge" })),
    removeNetwork: vi.fn(async () => true),
    listVolumes: vi.fn(async () => [{ Name: "data" }]),
    inspectVolume: vi.fn(async () => ({ Name: "data" })),
    removeVolume: vi.fn(async () => true),
  };
  return { ...ops, ...overrides };
}
