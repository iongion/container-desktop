import { describe, expect, it } from "vitest";

import type { Container, Volume } from "@/env/Types";
import type { MergedResource } from "@/web-app/hooks/useMergedResources";

import { buildMountGroups, type MountTreeItem, normalizeContainerMounts } from "./mountRows";

// Build a merged container with just the fields the normalizer reads (the rest is irrelevant here).
function container(partial: {
  id: string;
  name: string;
  connectionId: string;
  connectionName?: string;
  engine?: string;
  mounts: unknown[];
}): MergedResource<Container> {
  return {
    Id: partial.id,
    Names: [`/${partial.name}`],
    Computed: { Name: partial.name, DecodedState: "running" },
    Mounts: partial.mounts,
    engine: partial.engine ?? "podman",
    connectionId: partial.connectionId,
    connectionName: partial.connectionName ?? partial.connectionId,
  } as unknown as MergedResource<Container>;
}

function volume(partial: {
  name: string;
  connectionId: string;
  uid?: number;
  gid?: number;
  size?: number;
}): MergedResource<Volume> {
  return {
    Name: partial.name,
    UID: partial.uid ?? 0,
    GID: partial.gid ?? 0,
    UsageData: typeof partial.size === "number" ? { Size: partial.size, RefCount: 1 } : undefined,
    Driver: "local",
    engine: "podman",
    connectionId: partial.connectionId,
    connectionName: partial.connectionId,
  } as unknown as MergedResource<Volume>;
}

const isContainer = (item: MountTreeItem) => item.kind === "container";
const isMount = (item: MountTreeItem) => item.kind === "mount";

describe("normalizeContainerMounts", () => {
  it("reads a full bind mount (Source→Destination, Type, ro/rw from RW/Mode)", () => {
    const rows = normalizeContainerMounts(
      container({
        id: "c1",
        name: "api-1",
        connectionId: "podman",
        mounts: [{ Type: "bind", Source: "/home/ion/app", Destination: "/app", Mode: "rw", RW: true }],
      }),
    );
    expect(rows[0]).toMatchObject({
      containerName: "api-1",
      type: "bind",
      source: "/home/ion/app",
      destination: "/app",
      mode: "rw",
    });
  });

  it("uses the volume name as the source for a volume mount, and reads ro from RW:false", () => {
    const rows = normalizeContainerMounts(
      container({
        id: "c1",
        name: "db",
        connectionId: "podman",
        mounts: [{ Type: "volume", Name: "pgdata", Source: "/var/.../pgdata/_data", Destination: "/data", RW: false }],
      }),
    );
    expect(rows[0]).toMatchObject({ type: "volume", source: "pgdata", destination: "/data", mode: "ro" });
  });

  it("handles the minimal list shape (Type/Name/Destination only) — unknown mode is blank, not a guess", () => {
    const rows = normalizeContainerMounts(
      container({
        id: "c1",
        name: "web",
        connectionId: "podman",
        mounts: [{ Type: "volume", Name: "site", Destination: "/site" }],
      }),
    );
    expect(rows[0]).toMatchObject({ type: "volume", source: "site", destination: "/site", mode: "" });
  });

  it("labels an anonymous volume (no Name/Source) as empty source", () => {
    const rows = normalizeContainerMounts(
      container({
        id: "c1",
        name: "svc",
        connectionId: "podman",
        mounts: [{ Type: "volume", Destination: "/tmp/cache" }],
      }),
    );
    expect(rows[0]).toMatchObject({ type: "volume", source: "", destination: "/tmp/cache" });
  });

  it("strips the leading slash from the container name and stamps the connection", () => {
    const rows = normalizeContainerMounts(
      container({
        id: "c1",
        name: "api-1",
        connectionId: "podman",
        connectionName: "System Podman",
        mounts: [{ Type: "bind", Source: "/a", Destination: "/b" }],
      }),
    );
    expect(rows[0]).toMatchObject({
      containerName: "api-1",
      connectionId: "podman",
      connectionName: "System Podman",
      engine: "podman",
    });
  });
});

describe("buildMountGroups (tree grid)", () => {
  it("groups by connection; each container appears once, followed by its mounts (Connection→Container→Mount)", () => {
    const c1 = container({
      id: "c1",
      name: "api-1",
      connectionId: "podman",
      connectionName: "System Podman",
      mounts: [
        { Type: "bind", Source: "/z", Destination: "/z" },
        { Type: "bind", Source: "/a", Destination: "/a" },
      ],
    });
    const c2 = container({
      id: "c2",
      name: "api-2",
      connectionId: "podman",
      connectionName: "System Podman",
      mounts: [{ Type: "volume", Name: "data", Destination: "/data" }],
    });
    // Pass containers out of order to prove alphanumeric ordering.
    const groups = buildMountGroups([c2, c1], [], "");
    expect(groups).toHaveLength(1);
    const group = groups[0];
    expect(group.connection).toMatchObject({ id: "podman", name: "System Podman", engine: "podman" });
    // container appears ONCE each, alphanumeric asc; mounts nest after their container, alphanumeric asc.
    expect(group.items.map((i) => i.kind)).toEqual(["container", "mount", "mount", "container", "mount"]);
    expect(
      group.items.filter(isContainer).map((i) => (i.kind === "container" ? i.container.containerName : "")),
    ).toEqual(["api-1", "api-2"]);
    expect(group.items.filter(isMount).map((i) => (i.kind === "mount" ? i.mount.destination : ""))).toEqual([
      "/a",
      "/z",
      "/data",
    ]);
  });

  it("marks the last / only item in each branch as terminal (isLastContainer / isLastInContainer)", () => {
    const c1 = container({
      id: "c1",
      name: "api-1",
      connectionId: "podman",
      mounts: [
        { Type: "bind", Source: "/a", Destination: "/a" },
        { Type: "bind", Source: "/b", Destination: "/b" },
      ],
    });
    const c2 = container({
      id: "c2",
      name: "api-2",
      connectionId: "podman",
      mounts: [{ Type: "bind", Source: "/c", Destination: "/c" }],
    });
    const items = buildMountGroups([c1, c2], [], "")[0].items;
    const containers = items.filter(isContainer);
    expect(containers.map((i) => (i.kind === "container" ? i.isLastContainer : null))).toEqual([false, true]);
    // api-1 has two mounts (last one terminal); api-2's single mount is terminal too.
    const mountFlags = items.filter(isMount).map((i) => (i.kind === "mount" ? i.isLastInContainer : null));
    expect(mountFlags).toEqual([false, true, true]);
  });

  it("sorts the first column as a container tree, keeping container order and mount children", () => {
    const c1 = container({
      id: "c1",
      name: "z-api",
      connectionId: "podman",
      mounts: [
        { Type: "volume", Name: "z-cache", Destination: "/cache" },
        { Type: "bind", Source: "/a", Destination: "/app" },
      ],
    });
    const c2 = container({
      id: "c2",
      name: "a-api",
      connectionId: "podman",
      mounts: [{ Type: "bind", Source: "/z", Destination: "/z" }],
    });
    const items = buildMountGroups([c1, c2], [], "", { field: "mount", dir: "asc" })[0].items;

    expect(items.map((item) => item.kind)).toEqual(["container", "mount", "container", "mount", "mount"]);
    expect(
      items.filter(isContainer).map((item) => (item.kind === "container" ? item.container.containerName : "")),
    ).toEqual(["a-api", "z-api"]);
    expect(items.filter(isMount).map((item) => (item.kind === "mount" ? item.mount.source : ""))).toEqual([
      "/z",
      "/a",
      "z-cache",
    ]);
  });

  it("sorts non-first columns globally within the connection, ignoring default container ordering", () => {
    const c1 = container({
      id: "c1",
      name: "a-api",
      connectionId: "podman",
      mounts: [{ Type: "bind", Source: "/b", Destination: "/b" }],
    });
    const c2 = container({
      id: "c2",
      name: "z-api",
      connectionId: "podman",
      mounts: [{ Type: "volume", Name: "v", Destination: "/v" }],
    });
    const items = buildMountGroups([c1, c2], [], "", { field: "type", dir: "desc" })[0].items;

    expect(items.map((item) => item.kind)).toEqual(["mount", "mount"]);
    expect(items.filter(isMount).map((item) => (item.kind === "mount" ? item.mount.type : ""))).toEqual([
      "volume",
      "bind",
    ]);
  });

  it("enriches a volume mount's owner from the SAME connection's volume UID:GID", () => {
    const pod = container({
      id: "c1",
      name: "db",
      connectionId: "podman",
      mounts: [{ Type: "volume", Name: "data", Destination: "/data" }],
    });
    const dock = container({
      id: "c2",
      name: "db",
      connectionId: "docker",
      engine: "docker",
      connectionName: "docker",
      mounts: [{ Type: "volume", Name: "data", Destination: "/data" }],
    });
    const groups = buildMountGroups(
      [pod, dock],
      [volume({ name: "data", connectionId: "podman", uid: 1000, gid: 1000 })],
      "",
    );
    const podMount = groups.find((g) => g.key === "podman")?.items.find(isMount);
    const dockMount = groups.find((g) => g.key === "docker")?.items.find(isMount);
    expect(podMount?.kind === "mount" ? podMount.mount.owner : "x").toBe("1000:1000");
    expect(dockMount?.kind === "mount" ? dockMount.mount.owner : "x").toBeUndefined();
  });

  it("enriches a volume mount's size from the SAME connection's volume UsageData.Size", () => {
    const pod = container({
      id: "c1",
      name: "db",
      connectionId: "podman",
      mounts: [{ Type: "volume", Name: "data", Destination: "/data" }],
    });
    const dock = container({
      id: "c2",
      name: "db",
      connectionId: "docker",
      engine: "docker",
      connectionName: "docker",
      mounts: [{ Type: "volume", Name: "data", Destination: "/data" }],
    });
    const groups = buildMountGroups([pod, dock], [volume({ name: "data", connectionId: "podman", size: 123_456 })], "");
    const podMount = groups.find((g) => g.key === "podman")?.items.find(isMount);
    const dockMount = groups.find((g) => g.key === "docker")?.items.find(isMount);
    expect(podMount?.kind === "mount" ? podMount.mount.size : 0).toBe(123_456);
    expect(dockMount?.kind === "mount" ? dockMount.mount.size : 0).toBeUndefined();
  });

  it("filters by search and drops emptied containers / connections", () => {
    const c1 = container({
      id: "c1",
      name: "api-1",
      connectionId: "podman",
      mounts: [{ Type: "bind", Source: "/keep", Destination: "/keep" }],
    });
    const c2 = container({
      id: "c2",
      name: "other",
      connectionId: "podman",
      mounts: [{ Type: "bind", Source: "/drop", Destination: "/drop" }],
    });
    const items = buildMountGroups([c1, c2], [], "keep")[0].items;
    expect(items.filter(isContainer)).toHaveLength(1);
    expect(items.filter(isMount)).toHaveLength(1);
  });

  it("omits connections that have no mounts", () => {
    const withMounts = container({
      id: "c1",
      name: "db",
      connectionId: "podman",
      mounts: [{ Type: "volume", Name: "data", Destination: "/data" }],
    });
    const empty = container({ id: "c2", name: "idle", connectionId: "other", mounts: [] });
    expect(buildMountGroups([withMounts, empty], [], "").map((g) => g.key)).toEqual(["podman"]);
  });
});
