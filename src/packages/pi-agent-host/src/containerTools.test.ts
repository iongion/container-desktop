import { beforeEach, describe, expect, it, vi } from "vitest";

import { CONTAINER_TOOL_NAMES } from "@/ai-system/core/toolNames";
import { createContainerToolsExtension } from "@/pi-agent-host/containerTools";
import type { HostRpc } from "@/pi-agent-host/hostRpc";
import type { EngineOpResult } from "@/pi-bridge/protocol";

const descriptions = Object.fromEntries(CONTAINER_TOOL_NAMES.map((name) => [name, `does ${name}`]));

interface RegisteredTool {
  name: string;
  description: string;
  parameters: unknown;
  execute: (
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
  ) => Promise<{ content: Array<{ type: string; text?: string }>; details: unknown }>;
}

function register(answer: EngineOpResult | undefined) {
  const request = vi.fn(async () => answer);
  const rpc = { request, notify: vi.fn(), settle: vi.fn() } as unknown as HostRpc;
  const tools: RegisteredTool[] = [];
  const extension = createContainerToolsExtension({ rpc, descriptions });
  extension.factory({ registerTool: (tool: unknown) => tools.push(tool as RegisteredTool) } as never);
  return { tools, request, byName: (name: string) => tools.find((tool) => tool.name === name) as RegisteredTool };
}

describe("createContainerToolsExtension", () => {
  let harness: ReturnType<typeof register>;

  beforeEach(() => {
    harness = register({ ok: true, value: [{ Id: "c1" }] });
  });

  it("is a named extension, so pi can attribute what it contributes", () => {
    expect(createContainerToolsExtension({ rpc: {} as HostRpc, descriptions }).name).toBeTruthy();
  });

  it("registers every container tool with pi", () => {
    expect(harness.tools.map((tool) => tool.name)).toEqual([...CONTAINER_TOOL_NAMES]);
  });

  it("asks the app to perform the operation, naming it and passing the arguments through", async () => {
    await harness.byName("inspectContainer").execute("call-1", { id: "c1" });
    expect(harness.request).toHaveBeenCalledWith(
      "engine_op",
      { op: "inspectContainer", args: { id: "c1" } },
      expect.objectContaining({ fallback: expect.objectContaining({ ok: false }) }),
    );
  });

  // The cards read `details` (piSessionView maps tool_end.details → the card's result), so the engine payload has
  // to travel there unchanged; the text is what the model reads.
  it("returns the engine payload as details and as text", async () => {
    const result = await harness.byName("listContainers").execute("call-1", {});
    expect(result.details).toEqual([{ Id: "c1" }]);
    expect(result.content[0]).toEqual({ type: "text", text: JSON.stringify([{ Id: "c1" }], null, 2) });
  });

  it("passes a string payload through as text rather than re-quoting it as JSON", async () => {
    const logs = register({ ok: true, value: "line one\nline two" });
    const result = await logs.byName("getContainerLogs").execute("call-1", { id: "c1" });
    expect(result.content[0]).toEqual({ type: "text", text: "line one\nline two" });
  });

  it("reports a successful mutation in words the model can act on", async () => {
    const started = register({ ok: true, value: true });
    const result = await started.byName("startContainer").execute("call-1", { id: "c1" });
    expect(result.content[0]?.text).toContain("startContainer");
  });

  // pi has no error field on a tool result: throwing is what marks it isError, which is what the bridge carries.
  it("throws the app's reason when the operation failed", async () => {
    const failed = register({ ok: false, error: 'Connection "gone" is not running.' });
    await expect(failed.byName("stopContainer").execute("call-1", { id: "c1" })).rejects.toThrow(
      'Connection "gone" is not running.',
    );
  });

  it("throws rather than reporting success when the app never answered", async () => {
    const silent = register(undefined);
    await expect(silent.byName("listContainers").execute("call-1", {})).rejects.toThrow();
  });

  it("forwards the abort signal so a cancelled turn stops waiting on the app", async () => {
    const controller = new AbortController();
    await harness.byName("listContainers").execute("call-1", {}, controller.signal);
    expect(harness.request).toHaveBeenCalledWith(
      "engine_op",
      expect.anything(),
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});
