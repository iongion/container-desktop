import { describe, expect, it, vi } from "vitest";

import type { ConnectionExecHost } from "@/ai-system/core/ports";
import type { EngineOps } from "@/ai-system/core/types";
import { createExecutionSelector } from "@/platform/capabilities/executionSelector";

interface ContainerExecCall {
  connectionId: string;
  containerId: string;
  program: string;
  args: string[];
}

function fakeConnectionExec() {
  const onConnection: { connectionId: string; program: string; args: string[] }[] = [];
  const inContainer: ContainerExecCall[] = [];
  const created: { connectionId: string; image: string }[] = [];
  const removed: { connectionId: string; containerId: string }[] = [];
  const host: ConnectionExecHost = {
    execOnConnection: async (connectionId, program, args) => {
      onConnection.push({ connectionId, program, args });
      return { code: 0, stdout: "", stderr: "", truncated: false };
    },
    execInContainer: async (connectionId, containerId, program, args) => {
      inContainer.push({ connectionId, containerId, program, args });
      return { code: 0, stdout: "", stderr: "", truncated: false };
    },
    createSandboxContainer: vi.fn(async (connectionId, image) => {
      created.push({ connectionId, image });
      return { containerId: "sandbox-123" };
    }),
    removeSandboxContainer: vi.fn(async (connectionId, containerId) => {
      removed.push({ connectionId, containerId });
    }),
  };
  return { host, onConnection, inContainer, created, removed };
}

describe("createExecutionSelector", () => {
  it("container routes workspace ops through execInContainer with a container floor", async () => {
    const cx = fakeConnectionExec();
    const selector = createExecutionSelector({ runId: "r1", connectionExec: cx.host });
    const resolved = await selector.select({ kind: "container", connectionId: "c1", containerId: "cid" });
    expect(resolved.floorScope).toBe("container");
    await resolved.workspaceAccess?.read("a.txt");
    expect(cx.inContainer).toContainEqual({
      connectionId: "c1",
      containerId: "cid",
      program: "cat",
      args: ["/tmp/container-desktop-ai/r1/a.txt"],
    });
  });

  it("sandbox creates once, execs in the created container, disposes once", async () => {
    const cx = fakeConnectionExec();
    const selector = createExecutionSelector({ runId: "r1", connectionExec: cx.host });
    const target = { kind: "sandbox", connectionId: "c1", image: "alpine:3" } as const;

    const a = await selector.select(target);
    const b = await selector.select(target);
    expect(a).toBe(b); // memoized per distinct target
    expect(cx.created).toEqual([{ connectionId: "c1", image: "alpine:3" }]);
    expect(a.floorScope).toBe("sandbox");

    await a.workspaceAccess?.write("out.txt", "hi");
    expect(cx.inContainer.some((c) => c.containerId === "sandbox-123" && c.program === "tee")).toBe(true);

    await a.dispose();
    await a.dispose();
    expect(cx.removed).toEqual([{ connectionId: "c1", containerId: "sandbox-123" }]);
  });

  it("container surfaces a failed workspace mkdir instead of silently continuing", async () => {
    const host: ConnectionExecHost = {
      execOnConnection: async () => ({ code: 0, stdout: "", stderr: "", truncated: false }),
      execInContainer: async () => ({ code: 1, stdout: "", stderr: "mkdir: read-only file system", truncated: false }),
      createSandboxContainer: async () => ({ containerId: "x" }),
      removeSandboxContainer: async () => undefined,
    };
    const selector = createExecutionSelector({ runId: "r1", connectionExec: host });
    await expect(selector.select({ kind: "container", connectionId: "c1", containerId: "cid" })).rejects.toThrow(
      /read-only file system/,
    );
  });

  it("scopes engineOps to the target connection, model connectionId still wins", async () => {
    const cx = fakeConnectionExec();
    const seen: (string | undefined)[] = [];
    const engineOps = {
      listContainers: (arg?: { connectionId?: string }) => {
        seen.push(arg?.connectionId);
        return Promise.resolve([]);
      },
    } as unknown as EngineOps;
    const selector = createExecutionSelector({ runId: "r1", engineOps, connectionExec: cx.host });
    const resolved = await selector.select({ kind: "container", connectionId: "c1", containerId: "cid" });
    await (resolved.engineOps as unknown as { listContainers: (a?: unknown) => Promise<unknown> }).listContainers({});
    await (resolved.engineOps as unknown as { listContainers: (a?: unknown) => Promise<unknown> }).listContainers({
      connectionId: "other",
    });
    expect(seen).toEqual(["c1", "other"]);
  });
});
