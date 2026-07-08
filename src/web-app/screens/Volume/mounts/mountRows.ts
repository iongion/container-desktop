// Pure data layer for the Mounts inspector TREE GRID: Connection → Container (shown once) → Mount leaves, so a
// container appears once and its mounts nest beneath it (less crowded). Reads raw `Container.Mounts` (typed
// `any[]`): full on a real engine (Source/Mode/RW/Driver/Propagation), minimal in the mock list
// (Type/Name/Destination) — both handled. Owner comes from the connection's matching Volume (UID:GID). Containers
// and their mounts are ordered alphanumerically ascending, like a file system. Probe-only fields
// (backend/latency/health) are NOT modelled here; the UI renders them as honest placeholders. The flattened
// tree-item list per connection feeds `flattenConnectionGroups`. Pure → unit-tested.

import type { Container, Volume } from "@/env/Types";
import type { ConnectionGroup } from "@/web-app/components/groupedTable/flattenConnectionGroups";
import { sortAlphaNum } from "@/web-app/domain/utils";
import type { MergedResource } from "@/web-app/hooks/useMergedResources";
import { compareSortValues } from "@/web-app/utils/comparators";

// The subset of a raw mount entry we read (Container.Mounts is `any[]`; shape varies by engine/endpoint).
interface RawMount {
  Type?: string;
  Name?: string;
  Source?: string;
  Destination?: string;
  Target?: string;
  Mode?: string;
  RW?: boolean;
  Driver?: string;
  Propagation?: string;
}

export interface MountConnection {
  id: string;
  name: string;
  engine: string;
}

export interface MountRow {
  /** Connection-qualified, stable — the row's DOM/React key. */
  key: string;
  connectionId: string;
  connectionName: string;
  engine: string;
  containerId: string;
  containerName: string;
  /** "bind" | "volume" | … (raw). */
  type: string;
  /** Host path (bind) or volume name (volume); "" for an anonymous volume / unknown. */
  source: string;
  destination: string;
  /** "rw" | "ro" | "" when unknown (never guessed). */
  mode: string;
  /** "uid:gid" — only for a volume mount matched to its connection's Volume; undefined otherwise (probe later). */
  owner?: string;
  /** Volume size in bytes — from the matched volume's UsageData (only when the engine's list offers size). */
  size?: number;
}

export interface MountContainerNode {
  connectionId: string;
  engine: string;
  containerId: string;
  containerName: string;
}

// One flattened tree row: a container branch (shown once) or a mount leaf beneath it.
export type MountTreeItem =
  | { kind: "container"; key: string; container: MountContainerNode; isLastContainer: boolean }
  | {
      kind: "mount";
      key: string;
      mount: MountRow;
      isLastInContainer: boolean;
      // Whether this mount's container is the LAST in its connection — drives the continuing left trunk line on
      // mount rows (the group→container trunk must keep going past a non-last container's mounts).
      parentIsLastContainer: boolean;
    };

export interface MountGroup extends ConnectionGroup<MountTreeItem> {
  connection: MountConnection;
}

export type MountSortField = "mount" | "type" | "mode" | "owner" | "size";
export interface MountSort {
  field: MountSortField | string;
  dir: "asc" | "desc";
}

const VOLUME_SEP = " ";
const volumeKey = (connectionId: string, name: string): string => `${connectionId}${VOLUME_SEP}${name}`;
// File-system-like sort key: the source (volume name / host path) then destination.
const mountSortKey = (row: MountRow): string => `${row.source}\u0000${row.destination}`;

function compareMountRows(a: MountRow, b: MountRow, sort?: MountSort): number {
  if (!sort || sort.field === "mount") {
    return sortAlphaNum(mountSortKey(a), mountSortKey(b));
  }
  const direction = sort.dir === "asc" ? 1 : -1;
  const compared =
    sort.field === "type"
      ? compareSortValues(a.type, b.type)
      : sort.field === "mode"
        ? compareSortValues(a.mode, b.mode)
        : sort.field === "owner"
          ? compareSortValues(a.owner, b.owner)
          : sort.field === "size"
            ? compareSortValues(a.size, b.size)
            : sortAlphaNum(mountSortKey(a), mountSortKey(b));
  return direction * (compared || sortAlphaNum(mountSortKey(a), mountSortKey(b)));
}

function containerDisplayName(container: MergedResource<Container>): string {
  const name = container.Computed?.Name || container.Names?.[0] || container.Name || "";
  return name.replace(/^\/+/, "");
}

export function normalizeContainerMounts(container: MergedResource<Container>): MountRow[] {
  const mounts: RawMount[] = Array.isArray(container.Mounts) ? container.Mounts : [];
  const containerName = containerDisplayName(container);
  return mounts.map((raw, index) => {
    const type = typeof raw?.Type === "string" ? raw.Type : "";
    // Volume mounts read best as "<volume name> → dest"; binds as "<host path> → dest".
    const source = type === "volume" ? (raw?.Name ?? "") : (raw?.Source ?? raw?.Name ?? "");
    const destination = raw?.Destination ?? raw?.Target ?? "";
    const rw = typeof raw?.RW === "boolean" ? raw.RW : undefined;
    const mode = typeof raw?.Mode === "string" && raw.Mode ? raw.Mode : rw === false ? "ro" : rw === true ? "rw" : "";
    return {
      key: `${container.connectionId}:${container.Id}:${index}:${destination}`,
      connectionId: container.connectionId,
      connectionName: container.connectionName,
      engine: `${container.engine}`,
      containerId: container.Id,
      containerName,
      type,
      source: `${source}`,
      destination: `${destination}`,
      mode,
    };
  });
}

const createMountSearchFilter = (searchTerm: string) => {
  const query = searchTerm.toLowerCase();
  return (row: MountRow) =>
    [row.containerName, row.source, row.destination, row.type].some((value) => value.toLowerCase().includes(query));
};

interface ContainerBucket {
  node: MountContainerNode;
  mounts: MountRow[];
}
interface ConnectionBucket {
  connection: MountConnection;
  containers: Map<string, ContainerBucket>;
}

// Merge every connection's mounts into a Connection → Container → Mount tree, owner enriched from that
// connection's volumes, search-filtered. Containers (alphanumeric) each appear once, followed by their mounts
// (alphanumeric). Connections / containers with no (matching) mounts are omitted.
export function buildMountGroups(
  containers: MergedResource<Container>[],
  volumes: MergedResource<Volume>[],
  searchTerm: string,
  sort?: MountSort,
): MountGroup[] {
  const owners = new Map<string, string>();
  const sizes = new Map<string, number>();
  for (const vol of volumes) {
    if (vol?.Name && (typeof vol.UID === "number" || typeof vol.GID === "number")) {
      owners.set(volumeKey(vol.connectionId, vol.Name), `${vol.UID ?? 0}:${vol.GID ?? 0}`);
    }
    if (vol?.Name && typeof vol.UsageData?.Size === "number") {
      sizes.set(volumeKey(vol.connectionId, vol.Name), vol.UsageData.Size);
    }
  }
  const matches = searchTerm ? createMountSearchFilter(searchTerm) : undefined;
  const byConnection = new Map<string, ConnectionBucket>();
  for (const container of containers) {
    for (const row of normalizeContainerMounts(container)) {
      if (row.type === "volume" && row.source) {
        const lookup = volumeKey(row.connectionId, row.source);
        const owner = owners.get(lookup);
        if (owner) {
          row.owner = owner;
        }
        const size = sizes.get(lookup);
        if (typeof size === "number") {
          row.size = size;
        }
      }
      if (matches && !matches(row)) {
        continue;
      }
      let connection = byConnection.get(row.connectionId);
      if (!connection) {
        connection = {
          connection: { id: row.connectionId, name: row.connectionName, engine: row.engine },
          containers: new Map(),
        };
        byConnection.set(row.connectionId, connection);
      }
      let bucket = connection.containers.get(row.containerId);
      if (!bucket) {
        bucket = {
          node: {
            connectionId: row.connectionId,
            engine: row.engine,
            containerId: row.containerId,
            containerName: row.containerName,
          },
          mounts: [],
        };
        connection.containers.set(row.containerId, bucket);
      }
      bucket.mounts.push(row);
    }
  }
  const groups: MountGroup[] = [];
  for (const connection of byConnection.values()) {
    const containerBuckets = [...connection.containers.values()].sort((a, b) =>
      sortAlphaNum(a.node.containerName, b.node.containerName),
    );
    const items: MountTreeItem[] = [];
    if (sort && sort.field !== "mount") {
      const allMounts = containerBuckets
        .flatMap((bucket) => bucket.mounts)
        .sort((a, b) => compareMountRows(a, b, sort));
      allMounts.forEach((mount, mountIndex) => {
        items.push({
          kind: "mount",
          key: mount.key,
          mount,
          isLastInContainer: mountIndex === allMounts.length - 1,
          parentIsLastContainer: true,
        });
      });
      groups.push({ key: connection.connection.id, connection: connection.connection, items });
      continue;
    }
    containerBuckets.forEach((bucket, containerIndex) => {
      const isLastContainer = containerIndex === containerBuckets.length - 1;
      items.push({
        kind: "container",
        key: `container:${bucket.node.connectionId}:${bucket.node.containerId}`,
        container: bucket.node,
        isLastContainer,
      });
      const mounts = [...bucket.mounts].sort((a, b) => compareMountRows(a, b, sort));
      mounts.forEach((mount, mountIndex) => {
        items.push({
          kind: "mount",
          key: mount.key,
          mount,
          isLastInContainer: mountIndex === mounts.length - 1,
          parentIsLastContainer: isLastContainer,
        });
      });
    });
    groups.push({ key: connection.connection.id, connection: connection.connection, items });
  }
  groups.sort((a, b) => sortAlphaNum(a.connection.name, b.connection.name));
  return groups;
}
