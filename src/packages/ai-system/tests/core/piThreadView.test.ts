import { describe, expect, it } from "vitest";

import { emptyPiThreadView, projectPiThreadView } from "@/ai-system/core/piThreadView";
import { threadView as threadViewSchema } from "@/ai-system/core/schemas";
import type { BridgeEvent } from "@/pi-bridge/protocol";

const project = (events: BridgeEvent[]) =>
  events.reduce((view, event) => projectPiThreadView(view, event), emptyPiThreadView("t1"));

describe("projectPiThreadView", () => {
  it("produces a view that satisfies the shipped ThreadView schema", () => {
    const view = project([
      { type: "assistant_delta", text: "Hello" },
      { type: "assistant_end", text: "Hello", stopReason: "stop" },
    ]);
    expect(() => threadViewSchema.parse(view)).not.toThrow();
  });

  it("streams assistant text into one message item and tracks the streaming pointer", () => {
    const view = project([
      { type: "assistant_delta", text: "Hel" },
      { type: "assistant_delta", text: "lo" },
    ]);
    expect(view.timeline).toHaveLength(1);
    expect(view.timeline[0]).toMatchObject({ kind: "message", role: "assistant", content: "Hello" });
    expect(view.streamingAssistant).toMatchObject({ timelineIndex: 0, content: "Hello" });
    expect(view.phase).toBe("model");
  });

  it("clears the streaming pointer and marks the message complete on assistant_end", () => {
    const view = project([
      { type: "assistant_delta", text: "Hi" },
      { type: "assistant_end", text: "Hi", stopReason: "stop" },
    ]);
    expect(view.streamingAssistant).toBeUndefined();
    expect(view.timeline[0]).toMatchObject({ kind: "message", status: "complete" });
  });

  it("tracks a tool call through running to complete", () => {
    const view = project([
      { type: "tool_start", toolCallId: "c1", toolName: "bash", args: { command: "ls" } },
      { type: "tool_update", toolCallId: "c1", text: "partial" },
      { type: "tool_end", toolCallId: "c1", toolName: "bash", isError: false, text: "done", details: { a: 1 } },
    ]);
    expect(view.timeline).toHaveLength(1);
    expect(view.timeline[0]).toMatchObject({
      kind: "tool",
      toolCallId: "c1",
      tool: "bash",
      status: "complete",
      ok: true,
      message: "done",
    });
  });

  it("marks a failed tool call as an error status that is not ok", () => {
    const view = project([
      { type: "tool_start", toolCallId: "c1", toolName: "bash", args: {} },
      { type: "tool_end", toolCallId: "c1", toolName: "bash", isError: true, text: "boom" },
    ]);
    expect(view.timeline[0]).toMatchObject({ kind: "tool", status: "error", ok: false });
  });

  it("appends an error item and settles a streaming message", () => {
    const view = project([
      { type: "assistant_delta", text: "partial" },
      { type: "error", message: "model exploded" },
    ]);
    expect(view.timeline.map((item) => item.kind)).toEqual(["message", "error"]);
    expect(view.streamingAssistant).toBeUndefined();
    expect(view.timeline[1]).toMatchObject({ kind: "error", scope: "model", message: "model exploded" });
  });

  it("returns to idle on idle and advances lastSeq monotonically", () => {
    const view = project([
      { type: "assistant_delta", text: "a" },
      { type: "assistant_end", text: "a", stopReason: "stop" },
      { type: "idle" },
    ]);
    expect(view.phase).toBe("idle");
    expect(view.lastSeq).toBe(3);
  });

  it("records a user message so the transcript shows what was asked", () => {
    const view = projectPiThreadView(emptyPiThreadView("t1"), { type: "user_message", text: "hello agent" } as never);
    expect(view.timeline[0]).toMatchObject({ kind: "message", role: "user", content: "hello agent" });
  });

  it("ignores events that carry no transcript content", () => {
    const view = project([{ type: "turn_end" }, { type: "response", id: "c1", success: true }]);
    expect(view.timeline).toEqual([]);
  });

  it("keeps an empty view schema-valid", () => {
    expect(() => threadViewSchema.parse(emptyPiThreadView("t1"))).not.toThrow();
  });

  it("appends a pending approval card for a gated tool call and settles it in place", () => {
    const pending = projectPiThreadView(emptyPiThreadView("t1"), {
      type: "host_request",
      requestId: "r1",
      method: "approval",
      payload: { toolName: "bash", toolCallId: "tc1", args: { command: "rm -rf build" } },
    });
    expect(pending.timeline[0]).toMatchObject({
      kind: "approval",
      approvalId: "r1",
      tool: "bash",
      status: "pending",
      reason: "rm -rf build",
    });
    expect(pending.phase).toBe("awaiting-approval");
    expect(() => threadViewSchema.parse(pending)).not.toThrow();

    const settled = projectPiThreadView(pending, { type: "approval_settled", requestId: "r1", allowed: false });
    expect(settled.timeline[0]).toMatchObject({ kind: "approval", status: "rejected" });
    expect(settled.phase).toBe("tool");
  });

  it("marks an allowed approval allowed and leaves other cards alone", () => {
    const view = project([
      {
        type: "host_request",
        requestId: "r1",
        method: "approval",
        payload: { toolName: "bash", toolCallId: "tc1", args: { command: "ls" } },
      },
      {
        type: "host_request",
        requestId: "r2",
        method: "approval",
        payload: { toolName: "write", toolCallId: "tc2", args: { path: "a.ts" } },
      },
    ]);
    const settled = projectPiThreadView(view, { type: "approval_settled", requestId: "r2", allowed: true });
    expect(settled.timeline.map((item) => item.kind === "approval" && item.status)).toEqual(["pending", "allowed"]);
  });

  it("ignores a host_request that is not an approval, so chrome never enters the transcript", () => {
    const view = project([
      { type: "host_request", requestId: "r1", method: "setStatus", payload: { statusKey: "k", statusText: "busy" } },
      { type: "host_request", requestId: "r2", method: "confirm", payload: { title: "Allow?" } },
    ]);
    expect(view.timeline).toEqual([]);
  });

  it("ignores a settle for an approval it never saw", () => {
    const view = projectPiThreadView(emptyPiThreadView("t1"), {
      type: "approval_settled",
      requestId: "ghost",
      allowed: true,
    });
    expect(view.timeline).toEqual([]);
  });
});
