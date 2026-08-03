import { describe, expect, it } from "vitest";
import {
  cachedVerdict,
  emptyPermissionsCache,
  type PermissionDecisionContext,
  permissionKey,
  toolRule,
} from "@/ai-system/core/permissions";

const context = {
  workspaceId: "workspace-a",
  targetId: "host",
  subject: { kind: "access-profile", id: "operator" },
  contentTrustEpoch: "trusted",
} as const satisfies PermissionDecisionContext;

describe("scoped permission decisions", () => {
  it("normalizes arguments independently of object key order", () => {
    expect(permissionKey(toolRule(context, "pullImage", { reference: "nginx", connectionId: "c1" }))).toBe(
      permissionKey(toolRule(context, "pullImage", { connectionId: "c1", reference: "nginx" })),
    );
  });

  it.each([
    ["workspace", { ...context, workspaceId: "workspace-b" }],
    ["target", { ...context, targetId: "remote:connection-a" }],
    ["subject", { ...context, subject: { kind: "access-profile" as const, id: "observe" } }],
    ["content trust", { ...context, contentTrustEpoch: "project-pack-b" }],
  ])("does not reuse a decision across a different %s scope", (_name, other) => {
    const allowed = [toolRule(context, "removeContainer", { id: "a" })];
    const key = permissionKey(toolRule(other, "removeContainer", { id: "a" }));
    expect(cachedVerdict({ allowed, blocked: [] }, key)).toBeUndefined();
  });

  it("includes Worker identity without conflating it with an Access Profile", () => {
    const worker = { ...context, subject: { kind: "worker", id: "worker-a" } } as const;
    expect(permissionKey(toolRule(worker, "removeContainer", { id: "a" }))).not.toBe(
      permissionKey(toolRule(context, "removeContainer", { id: "a" })),
    );
  });

  it("keeps blocks authoritative when malformed duplicate lists contain both verdicts", () => {
    const rule = toolRule(context, "removeContainer", { id: "a" });
    const key = permissionKey(rule);
    expect(cachedVerdict({ allowed: [rule], blocked: [rule] }, key)).toBe("block");
  });

  it("starts with a versioned empty scoped cache", () => {
    expect(emptyPermissionsCache()).toEqual({ version: "2.0.0", allowed: [], blocked: [] });
  });
});
