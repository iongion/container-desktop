import { describe, expect, it, vi } from "vitest";
import { WEB_SEARCH_TOOL_NAME } from "@/ai-system/core/toolNames";
import type { HostRpc } from "@/pi-agent-host/hostRpc";
import { createWebSearchExtension } from "@/pi-agent-host/webSearchTool";
import type { WebSearchAnswer } from "@/pi-bridge/protocol";

interface RegisteredTool {
  name: string;
  description: string;
  parameters: unknown;
  execute: (
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
  ) => Promise<{ content: Array<{ type: string; text?: string }>; details?: unknown }>;
}

function register(answer: WebSearchAnswer | undefined) {
  const request = vi.fn(async () => answer);
  const rpc = { request, notify: vi.fn(), settle: vi.fn() } as unknown as HostRpc;
  const tools: RegisteredTool[] = [];
  createWebSearchExtension({ rpc, description: "search the public web" }).factory({
    registerTool: (tool: unknown) => tools.push(tool as RegisteredTool),
  } as never);
  return { request, tool: tools[0] };
}

describe("createWebSearchExtension", () => {
  it("registers one tool under the name the app already knows", () => {
    expect(register({ ok: true, text: "" }).tool.name).toBe(WEB_SEARCH_TOOL_NAME);
  });

  it("refuses to build a mute tool", () => {
    expect(() => createWebSearchExtension({ rpc: {} as HostRpc, description: "  " })).toThrow(/description/);
  });

  // The app runs the search: it owns the address-pinned public fetch and the user's toggle, and the container may
  // have no egress at all.
  it("asks the app to run the query and gives the model what came back", async () => {
    const harness = register({ ok: true, text: "## result\nsomething true" });
    const result = await harness.tool.execute("call-1", { query: "podman rootless" });
    expect(harness.request).toHaveBeenCalledWith(
      "web_search",
      { query: "podman rootless" },
      expect.objectContaining({ fallback: expect.objectContaining({ ok: false }) }),
    );
    expect(result.content[0]).toEqual({ type: "text", text: "## result\nsomething true" });
    // The card renders `details`, and a card that cannot say what was searched for is not worth rendering.
    expect(result.details).toEqual({ query: "podman rootless", text: "## result\nsomething true" });
  });

  // "Web search is off in Settings" is a reason the model can act on — it should answer from what it knows rather
  // than call the same tool again.
  it("throws the app's reason when the search was refused", async () => {
    const refused = register({ ok: false, error: "Web search is turned off in Settings → AI." });
    await expect(refused.tool.execute("call-1", { query: "x" })).rejects.toThrow("Settings → AI");
  });

  it("throws rather than reporting an empty result when the app never answered", async () => {
    await expect(register(undefined).tool.execute("call-1", { query: "x" })).rejects.toThrow();
  });

  it("forwards the abort signal so a stopped turn stops waiting on the app", async () => {
    const harness = register({ ok: true, text: "" });
    const controller = new AbortController();
    await harness.tool.execute("call-1", { query: "x" }, controller.signal);
    expect(harness.request).toHaveBeenCalledWith(
      "web_search",
      expect.anything(),
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});
