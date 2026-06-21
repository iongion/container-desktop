import { describe, expect, it } from "vitest";

import {
  type AICommandRule,
  type AIPermissionMode,
  cachedVerdict,
  commandKey,
  emptyPermissionsCache,
  resolveToolAction,
} from "./permissions";

describe("commandKey", () => {
  it("is the JSON tuple of program + args (matches the broker's historical approvalKey)", () => {
    expect(commandKey("podman", ["stop", "web"])).toBe(JSON.stringify(["podman", ["stop", "web"]]));
  });

  it("distinguishes different args", () => {
    expect(commandKey("podman", ["stop", "web"])).not.toBe(commandKey("podman", ["stop", "db"]));
  });
});

describe("resolveToolAction", () => {
  const modes: AIPermissionMode[] = ["ask", "remember", "allow"];

  it("always-allow runs everything — ignores floor and cache", () => {
    expect(resolveToolAction({ mode: "allow", floorBlocked: true, cached: "block" })).toBe("run");
    expect(resolveToolAction({ mode: "allow", floorBlocked: false, cached: undefined })).toBe("run");
  });

  it("floor blocks in ask + remember (but not allow)", () => {
    expect(resolveToolAction({ mode: "ask", floorBlocked: true })).toBe("reject");
    expect(resolveToolAction({ mode: "remember", floorBlocked: true, cached: "allow" })).toBe("reject");
  });

  it("always-ask prompts for everything, ignoring the cache", () => {
    expect(resolveToolAction({ mode: "ask", floorBlocked: false, cached: "allow" })).toBe("ask");
    expect(resolveToolAction({ mode: "ask", floorBlocked: false, cached: "block" })).toBe("ask");
    expect(resolveToolAction({ mode: "ask", floorBlocked: false })).toBe("ask");
  });

  it("ask-and-remember runs cached-allow, rejects cached-block, asks the undecided", () => {
    expect(resolveToolAction({ mode: "remember", floorBlocked: false, cached: "allow" })).toBe("run");
    expect(resolveToolAction({ mode: "remember", floorBlocked: false, cached: "block" })).toBe("reject");
    expect(resolveToolAction({ mode: "remember", floorBlocked: false, cached: undefined })).toBe("ask");
  });

  it("never throws for any mode", () => {
    for (const mode of modes) {
      expect(() => resolveToolAction({ mode, floorBlocked: false })).not.toThrow();
    }
  });
});

describe("cachedVerdict", () => {
  const allowed: AICommandRule[] = [{ program: "podman", args: ["stop", "web"] }];
  const blocked: AICommandRule[] = [{ program: "docker", args: ["system", "prune"] }];

  it("returns allow for an allow-listed command", () => {
    expect(cachedVerdict({ allowed, blocked }, commandKey("podman", ["stop", "web"]))).toBe("allow");
  });

  it("returns block for a block-listed command", () => {
    expect(cachedVerdict({ allowed, blocked }, commandKey("docker", ["system", "prune"]))).toBe("block");
  });

  it("returns undefined for an undecided command", () => {
    expect(cachedVerdict({ allowed, blocked }, commandKey("podman", ["ps"]))).toBeUndefined();
  });

  it("block wins over allow for the same key", () => {
    const key = commandKey("podman", ["rm", "x"]);
    const both = {
      allowed: [{ program: "podman", args: ["rm", "x"] }],
      blocked: [{ program: "podman", args: ["rm", "x"] }],
    };
    expect(cachedVerdict(both, key)).toBe("block");
  });

  it("empty cache decides nothing", () => {
    const cache = emptyPermissionsCache();
    expect(cache.allowed).toEqual([]);
    expect(cachedVerdict(cache, commandKey("podman", ["ps"]))).toBeUndefined();
  });
});
