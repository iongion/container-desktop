import { describe, expect, it } from "vitest";
import type { ContainerGroup } from "@/web-app/Types";
import {
  type ContainerConnectionGroup,
  type ContainerRowDescriptor,
  flattenGroups,
  type MergedContainer,
} from "./flattenGroups";

// Minimal fixtures — flattenGroups only reads Id/connectionId/Items/Name, so partial objects suffice.
const container = (connId: string, id: string, group: string): MergedContainer =>
  ({ Id: id, connectionId: connId, Computed: { Group: group } }) as unknown as MergedContainer;

const makeGroup = (name: string, items: MergedContainer[]): ContainerGroup =>
  ({ Id: `uuid-${name}-${items[0]?.connectionId ?? ""}`, Name: name, Items: items }) as unknown as ContainerGroup;

const makeConnection = (connId: string, groups: ContainerGroup[]): ContainerConnectionGroup => ({
  key: connId,
  connection: {
    id: connId,
    name: connId === "a" ? "System Podman" : "System Docker",
    engine: connId === "a" ? "podman" : "docker",
  },
  groups,
});

const rowKey = (c: MergedContainer) => `${c.connectionId}:${c.Id}`;
const kinds = (rows: ContainerRowDescriptor[]) => rows.map((row) => row.kind);

describe("flattenGroups", () => {
  it("emits a connection header, then a single row and no inner header for a one-item group", () => {
    const rows = flattenGroups([makeConnection("a", [makeGroup("solo", [container("a", "1", "solo")])])], {}, rowKey);
    expect(kinds(rows)).toEqual(["connection-header", "container"]);
    expect(rows[0]).toMatchObject({
      kind: "connection-header",
      key: "connection:a",
      connectionKey: "connection:a",
    });
    expect(rows[1]).toMatchObject({
      kind: "container",
      key: "a:1",
      indexInGroup: 0,
      isPartOfGroup: false,
      isFirst: true,
      isLast: true,
      connectionKey: "connection:a",
    });
  });

  it("emits connection header, group-header, then members of a multi-item group, in order", () => {
    const items = [container("a", "1", "web"), container("a", "2", "web"), container("a", "3", "web")];
    const rows = flattenGroups([makeConnection("a", [makeGroup("web", items)])], {}, rowKey);
    expect(kinds(rows)).toEqual(["connection-header", "group-header", "container", "container", "container"]);
    expect(rows[1]).toMatchObject({ kind: "group-header", connId: "a", connectionKey: "connection:a" });
    expect(rows[2]).toMatchObject({ key: "a:1", indexInGroup: 0, isPartOfGroup: true, isFirst: true, isLast: false });
    expect(rows[3]).toMatchObject({ indexInGroup: 1, isFirst: false, isLast: false });
    expect(rows[4]).toMatchObject({ indexInGroup: 2, isFirst: false, isLast: true });
  });

  it("renders only the header for a collapsed multi-item group (connection-qualified collapse key)", () => {
    const items = [container("a", "1", "web"), container("a", "2", "web")];
    const rows = flattenGroups([makeConnection("a", [makeGroup("web", items)])], { "group:a:web": true }, rowKey);
    expect(kinds(rows)).toEqual(["connection-header", "group-header"]);
  });

  it("renders only the connection header when a connection is collapsed", () => {
    const items = [container("a", "1", "web"), container("a", "2", "web")];
    const rows = flattenGroups([makeConnection("a", [makeGroup("web", items)])], { "connection:a": true }, rowKey);
    expect(kinds(rows)).toEqual(["connection-header"]);
  });

  it("renders the connection header and singleton row for a collapsed single-item inner group", () => {
    const rows = flattenGroups(
      [makeConnection("a", [makeGroup("solo", [container("a", "1", "solo")])])],
      { "group:a:solo": true },
      rowKey,
    );
    expect(kinds(rows)).toEqual(["connection-header", "container"]);
  });

  it("collapses same-named groups per connection independently (finding #7)", () => {
    const g1 = makeGroup("lamp", [container("a", "1", "lamp"), container("a", "2", "lamp")]);
    const g2 = makeGroup("lamp", [container("b", "1", "lamp"), container("b", "2", "lamp")]);
    // Collapse only connection a's "lamp" — connection b's "lamp" must stay expanded.
    const rows = flattenGroups(
      [makeConnection("a", [g1]), makeConnection("b", [g2])],
      { "group:a:lamp": true },
      rowKey,
    );
    expect(kinds(rows)).toEqual([
      "connection-header",
      "group-header",
      "connection-header",
      "group-header",
      "container",
      "container",
    ]);
    const headers = rows.filter((row) => row.kind === "group-header");
    expect(headers.map((h) => (h.kind === "group-header" ? h.groupKey : ""))).toEqual(["group:a:lamp", "group:b:lamp"]);
  });

  it("keeps same-named groups on different connections separate, with unique keys", () => {
    const g1 = makeGroup("lamp", [container("a", "1", "lamp"), container("a", "2", "lamp")]);
    const g2 = makeGroup("lamp", [container("b", "1", "lamp"), container("b", "2", "lamp")]);
    const rows = flattenGroups([makeConnection("a", [g1]), makeConnection("b", [g2])], {}, rowKey);
    const headers = rows.filter((row) => row.kind === "group-header");
    expect(headers).toHaveLength(2);
    expect(headers[0].key).not.toEqual(headers[1].key);
    const keys = rows.map((row) => row.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
