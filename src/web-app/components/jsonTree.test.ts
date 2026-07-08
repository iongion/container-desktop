import { describe, expect, it } from "vitest";

import { buildJsonTree, safeParseJson } from "./jsonTree";

describe("buildJsonTree", () => {
  it("returns one top-level node per object key, preserving the payload's order", () => {
    const tree = buildJsonTree({ a: 1, b: { c: "x" }, d: [true, null] });
    expect(tree.map((n) => n.key)).toEqual(["a", "b", "d"]);
  });

  it("classifies leaf kinds and formats their display value (strings quoted)", () => {
    const [a, , d] = buildJsonTree({ a: 1, b: {}, d: ["x"] });
    expect(a).toMatchObject({ key: "a", kind: "number", valueText: "1", isIndex: false });
    // string leaves are JSON-quoted so they read like JSON
    const str = d.children?.[0];
    expect(str).toMatchObject({ key: "0", isIndex: true, kind: "string", valueText: '"x"' });
  });

  it("marks objects/arrays as branches with a count summary and recurses", () => {
    const [, b, d] = buildJsonTree({ a: 1, b: { c: "x", e: 2 }, d: [true, null] });
    expect(b).toMatchObject({ kind: "object", summary: "{ 2 }" });
    expect(b.children).toHaveLength(2);
    expect(d).toMatchObject({ kind: "array", summary: "[ 2 ]" });
    expect(d.children?.map((c) => c.kind)).toEqual(["boolean", "null"]);
    expect(d.children?.map((c) => c.valueText)).toEqual(["true", "null"]);
  });

  it("represents empty objects/arrays as childless branches (no caret material)", () => {
    const [empty] = buildJsonTree({ e: {} });
    expect(empty).toMatchObject({ kind: "object", summary: "{ 0 }" });
    expect(empty.children).toHaveLength(0);
  });

  it("escapes strings via JSON so embedded quotes stay valid", () => {
    const [s] = buildJsonTree({ s: 'a"b' });
    expect(s.valueText).toBe('"a\\"b"');
  });

  it("gives every node a stable, unique id derived from its path", () => {
    const tree = buildJsonTree({ a: { b: 1 }, c: { b: 1 } });
    const ids = new Set<string>();
    const walk = (nodes: ReturnType<typeof buildJsonTree>) => {
      for (const n of nodes) {
        expect(ids.has(n.id)).toBe(false);
        ids.add(n.id);
        if (n.children) walk(n.children);
      }
    };
    walk(tree);
  });

  it("handles a primitive root as a single valueless-key node", () => {
    const tree = buildJsonTree("hello");
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ kind: "string", valueText: '"hello"' });
  });
});

describe("safeParseJson", () => {
  it("parses valid JSON", () => {
    expect(safeParseJson('{"a":1}')).toEqual({ ok: true, data: { a: 1 } });
  });

  it("reports an error instead of throwing on malformed/incomplete JSON", () => {
    const result = safeParseJson('{ "a": ');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
    }
  });
});
