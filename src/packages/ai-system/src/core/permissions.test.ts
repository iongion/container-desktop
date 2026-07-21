import { describe, expect, it } from "vitest";

import { isFloorBlocked, toolCommandFloorBlocked } from "./commandFloor";

import {
  type AIPermissionMode,
  cachedVerdict,
  commandKey,
  emptyPermissionsCache,
  type PermissionRule,
  resolveToolAction,
  resolveWorkerToolAction,
  toolKey,
} from "./permissions";

describe("commandKey", () => {
  it("is the JSON tuple of program + args (matches the broker's historical approvalKey)", () => {
    expect(commandKey("podman", ["stop", "web"])).toBe(JSON.stringify(["podman", ["stop", "web"]]));
  });

  it("distinguishes different args", () => {
    expect(commandKey("podman", ["stop", "web"])).not.toBe(commandKey("podman", ["stop", "db"]));
  });
});

describe("toolKey — first-class typed tools reuse the commandKey shape", () => {
  it("keys a tool under a `tool:` prefix with stable-stringified args", () => {
    expect(toolKey("removeContainer", { id: "abc" })).toBe(
      commandKey("tool:removeContainer", [JSON.stringify({ id: "abc" })]),
    );
  });

  it("is stable across arg key order", () => {
    expect(toolKey("pullImage", { reference: "nginx", connectionId: "c1" })).toBe(
      toolKey("pullImage", { connectionId: "c1", reference: "nginx" }),
    );
  });

  it("distinguishes tool name and args", () => {
    expect(toolKey("removeContainer", { id: "a" })).not.toBe(toolKey("removeContainer", { id: "b" }));
    expect(toolKey("startContainer", { id: "a" })).not.toBe(toolKey("stopContainer", { id: "a" }));
  });

  it("a verdict persisted as a command rule matches the tool key (cache stays single-sourced)", () => {
    const key = toolKey("removeContainer", { id: "x" });
    const blocked: PermissionRule[] = [{ program: "tool:removeContainer", args: [JSON.stringify({ id: "x" })] }];
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
  const allowed: PermissionRule[] = [{ program: "podman", args: ["stop", "web"] }];
  const blocked: PermissionRule[] = [{ program: "docker", args: ["system", "prune"] }];

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

// A worker's tool policy is the authority for its own tasks — both it and the global mode are user-authored,
// so a roster is not a privilege boundary. What a worker may NEVER do is bypass the catastrophic floor or
// overturn an explicit remembered block.
describe("resolveWorkerToolAction", () => {
  const base = { runMode: "ask" as AIPermissionMode, floorBlocked: false };

  it("runs everything under an all-allowed worker, whatever the global mode says", () => {
    expect(resolveWorkerToolAction({ ...base, policy: "all", runMode: "ask" })).toBe("run");
    expect(resolveWorkerToolAction({ ...base, policy: "all", runMode: "remember" })).toBe("run");
  });

  // The difference from the global "allow" mode, which predates workers and deliberately skips the floor.
  it("still rejects a catastrophic command for an all-allowed worker", () => {
    expect(resolveWorkerToolAction({ policy: "all", runMode: "allow", floorBlocked: true })).toBe("reject");
    expect(resolveToolAction({ mode: "allow", floorBlocked: true })).toBe("run");
  });

  it("never overturns an explicit remembered block", () => {
    expect(resolveWorkerToolAction({ ...base, policy: "all", cached: "block" })).toBe("reject");
    expect(resolveWorkerToolAction({ ...base, policy: "ask", cached: "block" })).toBe("reject");
    expect(resolveWorkerToolAction({ ...base, policy: "granular", cached: "block" })).toBe("reject");
  });

  // The point of "ask": it is the only way to gate an UNGATED read tool, which is the primary injection intake.
  it("asks for every call under a prompt-me worker, even a remembered allow", () => {
    expect(resolveWorkerToolAction({ ...base, policy: "ask" })).toBe("ask");
    expect(resolveWorkerToolAction({ ...base, policy: "ask", cached: "allow" })).toBe("ask");
    expect(resolveWorkerToolAction({ ...base, policy: "ask", runMode: "allow" })).toBe("ask");
  });

  it("defers to the global mode for a granular worker, whose toolset is already narrowed", () => {
    expect(resolveWorkerToolAction({ ...base, policy: "granular", runMode: "ask" })).toBe("ask");
    expect(resolveWorkerToolAction({ ...base, policy: "granular", runMode: "allow" })).toBe("run");
    expect(resolveWorkerToolAction({ ...base, policy: "granular", runMode: "remember", cached: "allow" })).toBe("run");
    expect(resolveWorkerToolAction({ ...base, policy: "granular", runMode: "remember" })).toBe("ask");
  });

  it("keeps the injection-taint rule for a granular worker's remembered allow", () => {
    const opts = {
      ...base,
      policy: "granular" as const,
      runMode: "remember" as AIPermissionMode,
      cached: "allow" as const,
    };
    expect(resolveWorkerToolAction(opts)).toBe("run");
    expect(resolveWorkerToolAction({ ...opts, tainted: true })).toBe("ask");
  });
});
