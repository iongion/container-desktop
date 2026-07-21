import { describe, expect, it } from "vitest";

import { DependencyError, topologicalStartOrder } from "./dependsOn";

const svc = (name: string, dependsOn: string[] = []) => ({ name, dependsOn });

describe("compose topologicalStartOrder", () => {
  it("orders a linear chain dependencies-first", () => {
    // a depends on b, b depends on c  →  start c, then b, then a
    const order = topologicalStartOrder([svc("a", ["b"]), svc("b", ["c"]), svc("c")]);
    expect(order).toEqual(["c", "b", "a"]);
  });

  it("keeps independent services in declaration order", () => {
    expect(topologicalStartOrder([svc("web"), svc("db"), svc("cache")])).toEqual(["web", "db", "cache"]);
  });

  it("starts every dependency before its dependents (diamond)", () => {
    // a → b,c ; b → d ; c → d
    const order = topologicalStartOrder([svc("a", ["b", "c"]), svc("b", ["d"]), svc("c", ["d"]), svc("d")]);
    expect(order.indexOf("d")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("d")).toBeLessThan(order.indexOf("c"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("a"));
    expect(order.indexOf("c")).toBeLessThan(order.indexOf("a"));
  });

  it("throws on a dependency cycle", () => {
    expect(() => topologicalStartOrder([svc("a", ["b"]), svc("b", ["a"])])).toThrow(DependencyError);
  });

  it("throws when depends_on references an undefined service", () => {
    expect(() => topologicalStartOrder([svc("a", ["ghost"])])).toThrow(/ghost/);
  });
});
