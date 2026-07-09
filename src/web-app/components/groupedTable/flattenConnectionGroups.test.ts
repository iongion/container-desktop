import { describe, expect, it } from "vitest";

import { type ConnectionGroup, flattenConnectionGroups } from "./flattenConnectionGroups";

// A minimal row type for the tests — the flatten is generic over the item shape.
interface Row {
  id: string;
}

// Real callers qualify the row key by connection (like `mergedKey`) — ids collide across connections, so the
// flatten hands each getRowKey its group so the descriptor key (also the selection id) stays unique.
const getRowKey = (row: Row, g: ConnectionGroup<Row>) => `${g.key}:${row.id}`;

const group = (key: string, ...ids: string[]): ConnectionGroup<Row> => ({
  key,
  items: ids.map((id) => ({ id })),
});

describe("flattenConnectionGroups", () => {
  it("emits a group-header per connection, then its rows (connection is ALWAYS a header, even single-item)", () => {
    const rows = flattenConnectionGroups([group("podman", "a")], {}, getRowKey);
    expect(rows.map((r) => r.kind)).toEqual(["group-header", "row"]);
    const [header, row] = rows;
    expect(header).toMatchObject({ kind: "group-header", groupKey: "podman" });
    expect(row).toMatchObject({ kind: "row", groupKey: "podman", isFirst: true, isLast: true });
  });

  it("flags isFirst / isLast across a multi-row group", () => {
    const rows = flattenConnectionGroups([group("podman", "a", "b", "c")], {}, getRowKey);
    const children = rows.filter((r) => r.kind === "row");
    expect(children.map((r) => (r.kind === "row" ? [r.item.id, r.isFirst, r.isLast] : null))).toEqual([
      ["a", true, false],
      ["b", false, false],
      ["c", false, true],
    ]);
  });

  it("shows only the header for a collapsed group (children omitted)", () => {
    const rows = flattenConnectionGroups([group("podman", "a", "b")], { podman: true }, getRowKey);
    expect(rows.map((r) => r.kind)).toEqual(["group-header"]);
  });

  it("emits a header (no rows) for an empty connection group", () => {
    const rows = flattenConnectionGroups([group("podman")], {}, getRowKey);
    expect(rows.map((r) => r.kind)).toEqual(["group-header"]);
  });

  it("preserves group order and interleaves header→rows per group", () => {
    const rows = flattenConnectionGroups([group("podman", "a"), group("docker", "b", "c")], {}, getRowKey);
    expect(rows.map((r) => (r.kind === "group-header" ? `H:${r.groupKey}` : `R:${r.item.id}`))).toEqual([
      "H:podman",
      "R:a",
      "H:docker",
      "R:b",
      "R:c",
    ]);
  });

  it("collapses each group independently", () => {
    const rows = flattenConnectionGroups([group("podman", "a"), group("docker", "b")], { podman: true }, getRowKey);
    expect(rows.map((r) => (r.kind === "group-header" ? `H:${r.groupKey}` : `R:${r.item.id}`))).toEqual([
      "H:podman",
      "H:docker",
      "R:b",
    ]);
  });

  it("gives every descriptor a unique, stable key", () => {
    const rows = flattenConnectionGroups([group("podman", "a", "b"), group("docker", "a")], {}, getRowKey);
    const keys = rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("flat mode (grouped=false): emits only rows across every group, in order, no headers", () => {
    const rows = flattenConnectionGroups([group("podman", "a"), group("docker", "b", "c")], {}, getRowKey, false);
    expect(rows.map((r) => r.kind)).toEqual(["row", "row", "row"]);
    expect(rows.map((r) => (r.kind === "row" ? r.item.id : null))).toEqual(["a", "b", "c"]);
  });

  it("flat mode (grouped=false): ignores collapse — every row is shown", () => {
    const rows = flattenConnectionGroups([group("podman", "a", "b")], { podman: true }, getRowKey, false);
    expect(rows.map((r) => r.kind)).toEqual(["row", "row"]);
  });

  it("flat mode with flatSort: merges every connection's items into ONE globally sorted list (not per group)", () => {
    const rows = flattenConnectionGroups(
      [group("podman", "c", "a"), group("docker", "b")],
      {},
      getRowKey,
      false,
      (x, y) => x.id.localeCompare(y.id),
    );
    expect(rows.map((r) => (r.kind === "row" ? r.item.id : null))).toEqual(["a", "b", "c"]);
  });
});
