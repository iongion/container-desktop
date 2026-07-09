import { describe, expect, it } from "vitest";

import { type Container, ContainerStateList } from "@/env/Types";
import type { SortSpec } from "@/web-app/stores/sortStore";

import { groupContainersAcrossConnections, isContainerGroupDirectory, isInfraContainer } from "./grouping";

const c = (name: string, group: string, state: ContainerStateList = ContainerStateList.RUNNING): Container =>
  ({
    Id: name,
    Names: [name],
    Image: "img",
    Pid: 0,
    Size: 0,
    Created: "2026-01-01",
    CreatedAt: "2026-01-01",
    Computed: { Name: name, Group: group, NameInGroup: name, DecodedState: state },
  }) as unknown as Container;

// Assert that every directory (multi-member group / Pod infrastructure) precedes every singleton.
const foldersFirst = (groups: ReturnType<typeof groupContainersAcrossConnections>) => {
  const isDir = groups.map(isContainerGroupDirectory);
  const lastDir = isDir.lastIndexOf(true);
  const firstSingleton = isDir.indexOf(false);
  return firstSingleton === -1 || lastDir === -1 || lastDir < firstSingleton;
};

describe("groupContainersAcrossConnections", () => {
  it("orders every directory group before singletons ACROSS connections (folders-first, globally)", () => {
    const connA = [c("web-1", "web"), c("web-2", "web"), c("alpha", "alpha")];
    const connB = [c("db-1", "db"), c("db-2", "db"), c("zeta", "zeta")];
    const groups = groupContainersAcrossConnections([connA, connB], "", { field: "name", dir: "asc" });
    expect(foldersFirst(groups)).toBe(true);
    // both real groups come first, then the singletons
    expect(
      groups
        .slice(0, 2)
        .map((g) => g.Name)
        .sort(),
    ).toEqual(["db", "web"]);
    expect(
      groups
        .slice(2)
        .map((g) => g.Name)
        .sort(),
    ).toEqual(["alpha", "zeta"]);
  });

  it("keeps folders-first regardless of the sort field/direction", () => {
    const connA = [c("web-1", "web"), c("web-2", "web"), c("alpha", "alpha")];
    const connB = [c("db-1", "db"), c("db-2", "db"), c("zeta", "zeta")];
    for (const sort of [
      { field: "name", dir: "desc" },
      { field: "created", dir: "asc" },
      { field: "state", dir: "desc" },
      undefined,
    ] as (SortSpec | undefined)[]) {
      expect(foldersFirst(groupContainersAcrossConnections([connA, connB], "", sort))).toBe(true);
    }
  });

  it("does not merge identically-named groups from different connections", () => {
    const connA = [c("web-1", "web"), c("web-2", "web")];
    const connB = [c("web-1", "web"), c("web-2", "web")];
    const groups = groupContainersAcrossConnections([connA, connB], "", { field: "name", dir: "asc" });
    const web = groups.filter((g) => g.Name === "web");
    expect(web.length).toBe(2);
  });
});

describe("isInfraContainer / hiding pod pause containers", () => {
  const infra = (name: string, isInfra: boolean): Container =>
    ({
      Id: name,
      Names: [`/${name}`],
      Image: "pause",
      Pid: 0,
      Size: 0,
      Created: "2026-01-01",
      CreatedAt: "2026-01-01",
      IsInfra: isInfra,
      Labels: { "com.docker.compose.project": "proj" },
      Computed: { Name: name, Group: "proj", NameInGroup: name, DecodedState: ContainerStateList.RUNNING },
    }) as unknown as Container;

  it("flags pod infra containers by IsInfra or by the `-infra` name suffix", () => {
    expect(isInfraContainer(infra("abc123-infra", true))).toBe(true);
    expect(isInfraContainer(infra("def456-infra", false))).toBe(true); // name-only (compat list omits IsInfra)
    expect(isInfraContainer(c("web-1", "proj"))).toBe(false);
  });

  it("keeps pod infra/pause containers out of the grouped list", () => {
    const groups = groupContainersAcrossConnections(
      [[c("web-1", "proj"), infra("abc123-infra", true), infra("def456-infra", false)]],
      "",
      { field: "name", dir: "asc" },
    );
    const names = groups.flatMap((g) => (g.Items as Container[]).map((it) => it.Computed.Name));
    expect(names).toContain("web-1");
    expect(names).not.toContain("abc123-infra");
    expect(names).not.toContain("def456-infra");
  });
});
