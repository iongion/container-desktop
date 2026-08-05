import { describe, expect, it, vi } from "vitest";

import { createPermissionGateExtension } from "@/pi-agent-host/permissionGate";

type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;

function bind(answer: unknown) {
  const handlers = new Map<string, Handler>();
  const rpc = { request: vi.fn(async () => answer), notify: vi.fn(), settle: vi.fn() };
  const extension = createPermissionGateExtension(rpc as never);
  extension.factory({ on: (event: string, handler: Handler) => handlers.set(event, handler) } as never);
  return { handlers, rpc };
}

const call = { toolName: "bash", toolCallId: "t1", input: { command: "rm -rf build" } };

describe("createPermissionGateExtension", () => {
  it("lets a tool run when the app allows it", async () => {
    const { handlers } = bind({ allow: true });
    await expect(handlers.get("tool_call")?.(call, {})).resolves.toBeUndefined();
  });

  it("blocks with the app's reason when the app rejects", async () => {
    const { handlers } = bind({ allow: false, reason: "denied by user" });
    await expect(handlers.get("tool_call")?.(call, {})).resolves.toEqual({
      block: true,
      reason: "denied by user",
    });
  });

  it("sends the tool name and arguments so the app can key its cache", async () => {
    const { handlers, rpc } = bind({ allow: true });
    await handlers.get("tool_call")?.(call, {});
    expect(rpc.request).toHaveBeenCalledWith(
      "approval",
      { toolName: "bash", toolCallId: "t1", args: { command: "rm -rf build" } },
      expect.objectContaining({ fallback: { allow: false, reason: "no response from the app" } }),
    );
  });

  it("fails closed when the app never answers", async () => {
    const { handlers } = bind(undefined);
    const result = (await handlers.get("tool_call")?.(call, {})) as { block?: boolean };
    expect(result?.block).toBe(true);
  });

  it("fails closed on a malformed verdict", async () => {
    const { handlers } = bind({ allowed: "yes" });
    await expect(handlers.get("tool_call")?.(call, {})).resolves.toMatchObject({ block: true });
  });

  it("blocks when asking the app throws", async () => {
    const handlers = new Map<string, Handler>();
    const rpc = {
      request: vi.fn(async () => {
        throw new Error("bridge closed");
      }),
      notify: vi.fn(),
      settle: vi.fn(),
    };
    createPermissionGateExtension(rpc as never).factory({
      on: (event: string, handler: Handler) => handlers.set(event, handler),
    } as never);
    await expect(handlers.get("tool_call")?.(call, {})).resolves.toMatchObject({ block: true });
  });
});
