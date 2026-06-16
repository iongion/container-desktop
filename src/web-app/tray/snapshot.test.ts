import { describe, expect, it } from "vitest";

import { normalizeContainer } from "@/container-client/normalizers/shared";
import type { Container } from "@/env/Types";
import type { TrayContainerGroup } from "./protocol";
import { buildTraySnapshot, type TraySnapshotInput } from "./snapshot";

function container(id: string, name: string, state: string, image = "docker.io/library/img:latest"): Container {
  return normalizeContainer({
    Id: id,
    Names: [name],
    Image: image,
    State: state,
    Created: 0,
  } as unknown as Container);
}

const baseInput: TraySnapshotInput = {
  running: true,
  currentConnector: { id: "c1", name: "Local", engine: "podman" },
  showAll: true,
};

function findGroup(groups: TrayContainerGroup[], name: string): TrayContainerGroup {
  const group = groups.find((g) => g.name === name);
  if (!group) {
    throw new Error(`group not found: ${name}`);
  }
  return group;
}

describe("buildTraySnapshot container grouping", () => {
  it("groups multi-container projects into directory groups and single containers into flat rows", () => {
    const snapshot = buildTraySnapshot({
      ...baseInput,
      containers: [
        container("a", "web-1", "running"),
        container("b", "web-2", "exited"),
        container("c", "solo", "running"),
      ],
    });

    const web = findGroup(snapshot.containerGroups, "web");
    expect(web.isDirectory).toBe(true);
    expect(web.items.map((i) => i.nameInGroup).sort()).toEqual(["1", "2"]);
    expect(web.report).toEqual({ running: 1, paused: 0, total: 2 });

    const solo = findGroup(snapshot.containerGroups, "solo");
    expect(solo.isDirectory).toBe(false);
    expect(solo.items).toHaveLength(1);
    expect(solo.items[0].name).toBe("solo");
  });

  it("pulls Pod infrastructure to the top with an icon", () => {
    const snapshot = buildTraySnapshot({
      ...baseInput,
      containers: [
        container("z1", "zzz-1", "running"),
        container("z2", "zzz-2", "running"),
        container("p", "mypod-infra", "running"),
      ],
    });

    expect(snapshot.containerGroups[0].name).toBe("Pod infrastructure");
    expect(snapshot.containerGroups[0].isDirectory).toBe(true);
    expect(snapshot.containerGroups[0].icon).toBeTruthy();
  });

  it("hides stopped containers and drops emptied groups when showAll is false", () => {
    const snapshot = buildTraySnapshot({
      ...baseInput,
      showAll: false,
      containers: [
        container("a", "web-1", "running"),
        container("b", "web-2", "exited"),
        container("o1", "old-1", "exited"),
        container("o2", "old-2", "exited"),
      ],
    });

    expect(snapshot.containerGroups).toHaveLength(1);
    const web = findGroup(snapshot.containerGroups, "web");
    expect(web.isDirectory).toBe(false);
    expect(web.items[0].name).toBe("web-1");
    expect(snapshot.containers).toHaveLength(1);
  });

  it("merges container stats into grouped rows", () => {
    const snapshot = buildTraySnapshot({
      ...baseInput,
      containers: [container("a", "web-1", "running"), container("b", "web-2", "running")],
      containerStats: new Map([["a", { cpuPercent: 12, memBytes: 100, memPercent: 5 }]]),
    });

    const web = findGroup(snapshot.containerGroups, "web");
    const a = web.items.find((i) => i.id === "a");
    const b = web.items.find((i) => i.id === "b");
    expect(a?.cpuPercent).toBe(12);
    expect(b?.cpuPercent).toBeUndefined();
  });
});
