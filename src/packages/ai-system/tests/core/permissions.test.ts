import { describe, expect, it } from "vitest";

import { isFloorBlocked, toolCommandFloorBlocked } from "@/ai-system/core/commandFloor";

import {
  type AIPermissionMode,
  cachedVerdict,
  emptyPermissionsCache,
  type PermissionDecisionContext,
  type PermissionRule,
  permissionKey,
  resolveToolAction,
  toolKey,
  toolRule,
} from "@/ai-system/core/permissions";

const CONTEXT: PermissionDecisionContext = {
  workspaceId: "workspace-a",
  targetId: "host",
  subject: { kind: "access-profile", id: "operator" },
  contentTrustEpoch: "application",
};

describe("toolKey", () => {
  it("keys a typed tool with its complete permission scope", () => {
    expect(toolKey(CONTEXT, "removeContainer", { id: "abc" })).toBe(
      permissionKey(toolRule(CONTEXT, "removeContainer", { id: "abc" })),
    );
  });

  it("is stable across arg key order", () => {
    expect(toolKey(CONTEXT, "pullImage", { reference: "nginx", connectionId: "c1" })).toBe(
      toolKey(CONTEXT, "pullImage", { connectionId: "c1", reference: "nginx" }),
    );
  });

  it("distinguishes tool name and args", () => {
    expect(toolKey(CONTEXT, "removeContainer", { id: "a" })).not.toBe(toolKey(CONTEXT, "removeContainer", { id: "b" }));
    expect(toolKey(CONTEXT, "startContainer", { id: "a" })).not.toBe(toolKey(CONTEXT, "stopContainer", { id: "a" }));
  });

  it("a persisted verdict matches the same tool scope", () => {
    const key = toolKey(CONTEXT, "removeContainer", { id: "x" });
    const blocked: PermissionRule[] = [toolRule(CONTEXT, "removeContainer", { id: "x" })];
    expect(cachedVerdict({ allowed: [], blocked }, key)).toBe("block");
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
  const allowed: PermissionRule[] = [toolRule(CONTEXT, "stopContainer", { id: "web" })];
  const blocked: PermissionRule[] = [toolRule(CONTEXT, "removeContainer", { id: "web" })];

  it("returns allow for an allowed operation", () => {
    expect(cachedVerdict({ allowed, blocked }, permissionKey(allowed[0]))).toBe("allow");
  });

  it("returns block for a blocked operation", () => {
    expect(cachedVerdict({ allowed, blocked }, permissionKey(blocked[0]))).toBe("block");
  });

  it("returns undefined for an undecided command", () => {
    expect(cachedVerdict({ allowed, blocked }, toolKey(CONTEXT, "startContainer", { id: "db" }))).toBeUndefined();
  });

  it("block wins over allow for the same key", () => {
    const rule = toolRule(CONTEXT, "removeContainer", { id: "x" });
    const key = permissionKey(rule);
    const both = {
      allowed: [rule],
      blocked: [rule],
    };
    expect(cachedVerdict(both, key)).toBe("block");
  });

  it("empty cache decides nothing", () => {
    const cache = emptyPermissionsCache();
    expect(cache.allowed).toEqual([]);
    expect(cachedVerdict(cache, toolKey(CONTEXT, "listContainers", {}))).toBeUndefined();
  });
});

describe("resolveToolAction — injection resistance", () => {
  const remembered = { mode: "remember" as const, floorBlocked: false, cached: "allow" as const };

  it("honors a remembered allow on an untainted turn", () => {
    expect(resolveToolAction({ ...remembered, tainted: false })).toBe("run");
    expect(resolveToolAction(remembered)).toBe("run");
  });

  it("re-prompts for a remembered allow once the turn ingested untrusted content", () => {
    expect(resolveToolAction({ ...remembered, tainted: true })).toBe("ask");
  });

  it("still rejects a remembered block on a tainted turn — taint never upgrades trust", () => {
    expect(resolveToolAction({ mode: "remember", floorBlocked: false, cached: "block", tainted: true })).toBe("reject");
  });

  it("leaves always-allow alone: taint does not override the user's explicit max-trust choice", () => {
    expect(resolveToolAction({ mode: "allow", floorBlocked: false, cached: "allow", tainted: true })).toBe("run");
  });

  it("keeps the floor above everything in ask/remember, tainted or not", () => {
    expect(resolveToolAction({ mode: "remember", floorBlocked: true, cached: "allow", tainted: false })).toBe("reject");
    expect(resolveToolAction({ mode: "ask", floorBlocked: true, tainted: true })).toBe("reject");
  });
});

describe("toolCommandFloorBlocked — the floor applied to typed tool calls by shape", () => {
  it("blocks an exec-shaped tool call running a banned program", () => {
    expect(toolCommandFloorBlocked({ program: "rm", args: ["-rf", "/"] })).toBe(true);
    expect(toolCommandFloorBlocked({ program: "bash", args: ["-c", "x"] })).toBe(true);
  });

  it("blocks shell metacharacters and traversal in an argument", () => {
    expect(toolCommandFloorBlocked({ program: "grep", args: ["$(whoami)"] })).toBe(true);
    expect(toolCommandFloorBlocked({ program: "cat", args: ["../../etc/shadow"] })).toBe(true);
  });

  it("allows an ordinary workspace command", () => {
    expect(toolCommandFloorBlocked({ program: "node", args: ["--version"] })).toBe(false);
    expect(toolCommandFloorBlocked({ program: "yarn", args: ["test"] })).toBe(false);
  });

  it("ignores structured tool calls that run no program", () => {
    expect(toolCommandFloorBlocked({ id: "abc123" })).toBe(false);
    expect(toolCommandFloorBlocked({ path: "src/a.ts", oldString: "a", newString: "b" })).toBe(false);
    expect(toolCommandFloorBlocked(undefined)).toBe(false);
    expect(toolCommandFloorBlocked("nope")).toBe(false);
  });

  it("agrees with isFloorBlocked, which the sandbox path uses directly", () => {
    expect(isFloorBlocked({ program: "rm", args: [] }).blocked).toBe(true);
    expect(isFloorBlocked({ program: "podman", args: ["ps"] }).blocked).toBe(false);
  });
});
