import { beforeEach, describe, expect, it } from "vitest";

import { applyResourceSyncSnapshot } from "./resourceMirror";
import { useResourceStore } from "./resourceStore";

beforeEach(() => {
  useResourceStore.getState().resetAll();
});

describe("applyResourceSyncSnapshot", () => {
  it("populates the resource store from a main-pushed sync snapshot", () => {
    applyResourceSyncSnapshot({
      appRuntime: { phase: "ready", running: true, osType: "Linux", connections: [] },
      resources: { "conn-1": { containers: [{ Id: "c1" } as any], pods: [] } },
    });
    const slice = useResourceStore.getState().byConnection["conn-1"];
    expect(slice.containers.items).toEqual([{ Id: "c1" }]);
    expect(slice.containers.loading).toBe(false);
    expect(slice.pods.items).toEqual([]);
  });

  it("prunes a connection that dropped out of the merged snapshot (disconnect)", () => {
    const store = useResourceStore.getState();
    store.ensureConnection("connA.docker");
    store.ensureConnection("connB.podman");
    store.setSnapshot("connB.podman", "containers", [{ Id: "podman-c1" } as any]);
    expect(Object.keys(useResourceStore.getState().byConnection).sort()).toEqual(["connA.docker", "connB.podman"]);

    // Main deletes a connection's state on disconnect → the next merged snapshot only contains docker.
    applyResourceSyncSnapshot({
      appRuntime: { phase: "ready", running: true, osType: "Linux", connections: [] },
      resources: { "connA.docker": { containers: [{ Id: "docker-c1" } as any] } },
    });

    const byConnection = useResourceStore.getState().byConnection;
    expect(Object.keys(byConnection)).toEqual(["connA.docker"]);
    expect(byConnection["connB.podman"]).toBeUndefined();
  });

  it("keeps every connection that is still present (normal multi-engine push)", () => {
    applyResourceSyncSnapshot({
      appRuntime: { phase: "ready", running: true, osType: "Linux", connections: [] },
      resources: {
        "connA.docker": { containers: [{ Id: "d1" } as any] },
        "connB.podman": { containers: [{ Id: "p1" } as any] },
      },
    });
    expect(Object.keys(useResourceStore.getState().byConnection).sort()).toEqual(["connA.docker", "connB.podman"]);
  });
});
