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
});
