import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MCP_PORT } from "@/container-client/mcpSettings";
import { MCP_CHANNELS, type McpController, registerMcpIpc } from "@/platform/mcpIpc";

function makeIpc() {
  const handlers = new Map<string, (event: any, payload: any) => unknown>();
  const controller: McpController = {
    apply: vi.fn(async () => ({ running: true, port: DEFAULT_MCP_PORT })),
    status: vi.fn(async () => ({ running: false })),
    token: vi.fn(async () => "a".repeat(64)),
    regenerateToken: vi.fn(async () => "b".repeat(64)),
    dispose: vi.fn(),
  };
  registerMcpIpc({
    onInvoke: (channel, handler) => handlers.set(channel, handler),
    isAllowedSender: (event) => event?.allowed === true,
    controller,
  });
  const invoke = (channel: string, payload?: unknown, event: unknown = { allowed: true }) =>
    handlers.get(channel)?.(event, payload);
  return { controller, invoke };
}

describe("registerMcpIpc", () => {
  it("applies normalized settings, so a malformed payload never opens the server wider", async () => {
    const { controller, invoke } = makeIpc();
    await invoke(MCP_CHANNELS.apply, { settings: { enabled: true, port: 80, mode: "ask" } });
    expect(controller.apply).toHaveBeenCalledWith(
      { enabled: true, port: DEFAULT_MCP_PORT, mode: "read-only" },
      { allowDegraded: false },
    );
  });

  it("applies the saved settings when the payload carries none", async () => {
    const { controller, invoke } = makeIpc();
    await invoke(MCP_CHANNELS.apply);
    expect(controller.apply).toHaveBeenCalledWith(undefined, { allowDegraded: false });
  });

  it("passes the consent to degraded token storage only when it is an explicit true", async () => {
    const { controller, invoke } = makeIpc();
    await invoke(MCP_CHANNELS.token, { allowDegraded: "yes" });
    expect(controller.token).toHaveBeenCalledWith({ allowDegraded: false });
    await invoke(MCP_CHANNELS.regenerateToken, { allowDegraded: true });
    expect(controller.regenerateToken).toHaveBeenCalledWith({ allowDegraded: true });
  });

  it("routes the status", async () => {
    const { controller, invoke } = makeIpc();
    await expect(invoke(MCP_CHANNELS.status)).resolves.toEqual({ running: false });
    expect(controller.status).toHaveBeenCalledTimes(1);
  });

  it("answers nothing to a sender other than the app window, and never hands it the token", async () => {
    const { controller, invoke } = makeIpc();
    const stranger = { allowed: false };
    await expect(invoke(MCP_CHANNELS.token, {}, stranger)).rejects.toThrow(/Denied/);
    await expect(invoke(MCP_CHANNELS.regenerateToken, {}, stranger)).rejects.toThrow(/Denied/);
    expect(await invoke(MCP_CHANNELS.apply, { settings: { enabled: true } }, stranger)).toMatchObject({
      running: false,
    });
    expect(await invoke(MCP_CHANNELS.status, undefined, stranger)).toMatchObject({ running: false });
    expect(controller.token).not.toHaveBeenCalled();
    expect(controller.regenerateToken).not.toHaveBeenCalled();
    expect(controller.apply).not.toHaveBeenCalled();
    expect(controller.status).not.toHaveBeenCalled();
  });
});
