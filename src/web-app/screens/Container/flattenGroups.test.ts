import { describe, expect, it } from "vitest";
import type { ContainerGroup } from "@/web-app/Types";
import { type ContainerRowDescriptor, flattenGroups, type MergedContainer } from "./flattenGroups";

// Minimal fixtures — flattenGroups only reads Id/connectionId/Items/Name, so partial objects suffice.
const container = (connId: string, id: string, group: string): MergedContainer =>
  ({ Id: id, connectionId: connId, Computed: { Group: group } }) as unknown as MergedContainer;

const makeGroup = (name: string, items: MergedContainer[]): ContainerGroup =>
  ({ Id: `uuid-${name}-${items[0]?.connectionId ?? ""}`, Name: name, Items: items }) as unknown as ContainerGroup;

const rowKey = (c: MergedContainer) => `${c.connectionId}:${c.Id}`;
const kinds = (rows: ContainerRowDescriptor[]) => rows.map((row) => row.kind);

describe("flattenGroups", () => {
  it("emits a single row and no header for a one-item group", () => {
    const rows = flattenGroups([makeGroup("solo", [container("a", "1", "solo")])], {}, rowKey);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "container",
      key: "a:1",
      indexInGroup: 0,
      isPartOfGroup: false,
      isFirst: true,
      isLast: true,
    });
  });

  it("emits a group-header before the members of a multi-item group, in order", () => {
    const items = [container("a", "1", "web"), container("a", "2", "web"), container("a", "3", "web")];
    const rows = flattenGroups([makeGroup("web", items)], {}, rowKey);
    expect(kinds(rows)).toEqual(["group-header", "container", "container", "container"]);
    expect(rows[0]).toMatchObject({ kind: "group-header", connId: "a" });
    expect(rows[1]).toMatchObject({ key: "a:1", indexInGroup: 0, isPartOfGroup: true, isFirst: true, isLast: false });
    expect(rows[2]).toMatchObject({ indexInGroup: 1, isFirst: false, isLast: false });
    expect(rows[3]).toMatchObject({ indexInGroup: 2, isFirst: false, isLast: true });
  });

  it("renders only the header for a collapsed multi-item group", () => {
    const items = [container("a", "1", "web"), container("a", "2", "web")];
    const rows = flattenGroups([makeGroup("web", items)], { web: true }, rowKey);
    expect(kinds(rows)).toEqual(["group-header"]);
  });

  it("renders nothing for a collapsed single-item group (faithful to current behavior)", () => {
    const rows = flattenGroups([makeGroup("solo", [container("a", "1", "solo")])], { solo: true }, rowKey);
    expect(rows).toHaveLength(0);
  });

  it("keeps same-named groups on different connections separate, with unique keys", () => {
    const g1 = makeGroup("lamp", [container("a", "1", "lamp"), container("a", "2", "lamp")]);
    const g2 = makeGroup("lamp", [container("b", "1", "lamp"), container("b", "2", "lamp")]);
    const rows = flattenGroups([g1, g2], {}, rowKey);
    const headers = rows.filter((row) => row.kind === "group-header");
    expect(headers).toHaveLength(2);
    expect(headers[0].key).not.toEqual(headers[1].key);
    const keys = rows.map((row) => row.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
