import { describe, expect, it } from "vitest";

import { executionTargetKey, floorScopeFor } from "@/ai-system/core/workers";

describe("floorScopeFor", () => {
  it("maps each target kind to its floor scope", () => {
    expect(floorScopeFor({ kind: "host" })).toBe("strict");
    expect(floorScopeFor({ kind: "remote", connectionId: "c1" })).toBe("strict");
    expect(floorScopeFor({ kind: "container", connectionId: "c1", containerId: "abc" })).toBe("container");
    expect(floorScopeFor({ kind: "sandbox", connectionId: "c1", image: "alpine:3" })).toBe("sandbox");
  });
});

describe("executionTargetKey", () => {
  it("is stable and distinct per target", () => {
    expect(executionTargetKey({ kind: "host" })).toBe("host");
    expect(executionTargetKey({ kind: "remote", connectionId: "c1" })).toBe("remote:c1");
    expect(executionTargetKey({ kind: "container", connectionId: "c1", containerId: "abc" })).toBe("container:c1:abc");
    expect(executionTargetKey({ kind: "sandbox", connectionId: "c1", image: "alpine:3" })).toBe("sandbox:c1:alpine:3");
  });

  it("distinguishes different connections and containers", () => {
    const a = executionTargetKey({ kind: "container", connectionId: "c1", containerId: "x" });
    const b = executionTargetKey({ kind: "container", connectionId: "c2", containerId: "x" });
    const c = executionTargetKey({ kind: "container", connectionId: "c1", containerId: "y" });
    expect(new Set([a, b, c]).size).toBe(3);
  });
});
