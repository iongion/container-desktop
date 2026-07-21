import { describe, expect, it } from "vitest";

import { formatLogArgs } from "./logFormat";

// plugin-log's JS functions take a single string message, but the @/logger façade hands the
// backend (level, scope, args[]) — mirroring console. formatLogArgs is the pure bridge between the two.
describe("formatLogArgs", () => {
  it("prefixes the scope and passes string args through unchanged", () => {
    expect(formatLogArgs("engine", ["hello", "world"])).toBe("[engine] hello world");
  });

  it("stringifies objects as JSON and primitives via String", () => {
    expect(formatLogArgs("api", [{ a: 1 }, 42, true])).toBe('[api] {"a":1} 42 true');
  });

  it("renders an Error with its message, never [object Object]", () => {
    const out = formatLogArgs("x", [new Error("boom")]);
    expect(out.startsWith("[x] ")).toBe(true);
    expect(out).toContain("boom");
    expect(out).not.toContain("[object Object]");
  });

  it("survives a circular object without throwing", () => {
    const circular: any = { name: "loop" };
    circular.self = circular;
    expect(() => formatLogArgs("c", [circular])).not.toThrow();
  });

  it("emits just the scope when there are no args (no trailing space)", () => {
    expect(formatLogArgs("empty", [])).toBe("[empty]");
  });
});
