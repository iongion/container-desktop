import { describe, expect, it } from "vitest";

import { isFloorBlocked, toolCommandFloorBlocked } from "@/ai-system/core/commandFloor";

describe("isFloorBlocked — target-aware scope", () => {
  it("blocks the destructive/privileged program denylist in strict + container scope", () => {
    for (const scope of ["strict", "container"] as const) {
      expect(isFloorBlocked({ program: "rm", args: ["-rf", "x"] }, scope).blocked).toBe(true);
      expect(isFloorBlocked({ program: "sudo", args: ["ls"] }, scope).blocked).toBe(true);
      expect(isFloorBlocked({ program: "curl", args: ["http://x"] }, scope).blocked).toBe(true);
      expect(isFloorBlocked({ program: "bash", args: ["-c", "x"] }, scope).blocked).toBe(true);
    }
  });

  it("lifts the program denylist inside a disposable sandbox", () => {
    expect(isFloorBlocked({ program: "rm", args: ["-rf", "build"] }, "sandbox").blocked).toBe(false);
    expect(isFloorBlocked({ program: "curl", args: ["https://example.test"] }, "sandbox").blocked).toBe(false);
    expect(isFloorBlocked({ program: "bash", args: ["-lc", "make test"] }, "sandbox").blocked).toBe(false);
  });

  it("keeps the structural rules in EVERY scope, including sandbox", () => {
    // shell metacharacter
    expect(isFloorBlocked({ program: "echo", args: ["a; rm b"] }, "sandbox").blocked).toBe(true);
    // path traversal
    expect(isFloorBlocked({ program: "cat", args: ["../secret"] }, "sandbox").blocked).toBe(true);
    // invalid program token
    expect(isFloorBlocked({ program: "/bin/sh", args: [] }, "sandbox").blocked).toBe(true);
    // non-string / non-array args
    expect(isFloorBlocked({ program: "ls", args: undefined as unknown as string[] }, "sandbox").blocked).toBe(true);
  });

  it("defaults to strict when no scope is passed (back-compatible)", () => {
    expect(isFloorBlocked({ program: "rm", args: ["x"] }).blocked).toBe(true);
  });
});

describe("toolCommandFloorBlocked — scope passthrough", () => {
  it("relaxes the denylist for sandbox but not strict", () => {
    expect(toolCommandFloorBlocked({ program: "rm", args: ["x"] }, "strict")).toBe(true);
    expect(toolCommandFloorBlocked({ program: "rm", args: ["x"] }, "sandbox")).toBe(false);
    expect(toolCommandFloorBlocked({ program: "rm", args: ["x"] })).toBe(true);
  });

  it("still guards structural rules in sandbox", () => {
    expect(toolCommandFloorBlocked({ program: "echo", args: ["a | b"] }, "sandbox")).toBe(true);
  });
});
