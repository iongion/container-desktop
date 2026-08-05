import { describe, expect, it } from "vitest";

import { emptyPiSessionView, projectPiSessionView } from "@/ai-system/core/piSessionView";
import { sessionView as sessionViewSchema } from "@/ai-system/core/schemas";
import type { BridgeEvent } from "@/pi-bridge/protocol";

const project = (events: BridgeEvent[]) =>
  events.reduce((view, event) => projectPiSessionView(view, event), emptyPiSessionView("t1"));

describe("projectPiSessionView", () => {
  it("produces a view that satisfies the shipped SessionView schema", () => {
    const view = project([
      { type: "assistant_delta", text: "Hello" },
      { type: "assistant_end", text: "Hello", stopReason: "stop" },
    ]);
    expect(() => sessionViewSchema.parse(view)).not.toThrow();
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
    const view = projectPiSessionView(emptyPiSessionView("t1"), { type: "user_message", text: "hello agent" } as never);
    expect(view.timeline[0]).toMatchObject({ kind: "message", role: "user", content: "hello agent" });
  });

  // The longest stretch of a turn is between the prompt and the first token, and nothing is on screen during
  // it: no output yet, no tool card. Staying idle there leaves every "is it working?" affordance switched off
  // for exactly as long as the model takes, so the session reads as frozen. The agent owes the answer the
  // moment the prompt is submitted, not once it starts speaking.
  it("is working from the moment the user submits, not from the first token", () => {
    const view = projectPiSessionView(emptyPiSessionView("t1"), { type: "user_message", text: "hello agent" } as never);
    expect(view.phase).toBe("model");
  });

  it("still returns to idle when a turn started by a submit ends", () => {
    const asked = projectPiSessionView(emptyPiSessionView("t1"), { type: "user_message", text: "q" } as never);
    const done = [
      { type: "assistant_delta", text: "a" },
      { type: "assistant_end", text: "a", stopReason: "stop" },
      { type: "idle" },
    ].reduce((view, event) => projectPiSessionView(view, event as never), asked);
    expect(done.phase).toBe("idle");
  });

  it("ignores events that carry no transcript content", () => {
    const view = project([{ type: "turn_end" }, { type: "response", id: "c1", success: true }]);
    expect(view.timeline).toEqual([]);
  });

  // Seen against a real 4B model: asked a repeated one-word prompt, it emitted a stop token immediately and the
  // server's own log said `eval time 0.00 ms / 1 tokens`. The turn ran, cost tokens and produced nothing — and the
  // transcript was indistinguishable from a turn that never started.
  it("says the model returned nothing when a finished turn produced no text", () => {
    const view = project([
      { type: "user_message", text: "say alpha" } as never,
      { type: "assistant_end", text: "", stopReason: "stop" },
    ]);
    expect(view.timeline).toHaveLength(2);
    expect(view.timeline[1]).toMatchObject({ kind: "notice", notice: "empty-answer" });
    expect(() => sessionViewSchema.parse(view)).not.toThrow();
  });

  // A cap reached with nothing to show is its own fact: the answer is not missing, it was cut off before it began.
  it("distinguishes a turn that stopped at its output cap", () => {
    const view = project([{ type: "assistant_end", text: "", stopReason: "length" }]);
    expect(view.timeline[0]).toMatchObject({ kind: "notice", notice: "output-cap" });
  });

  // A model that calls a tool without prose is the normal shape of a turn, not an empty answer: the tool card is
  // what it said. A notice here would sit above every single tool call.
  it("stays silent when a step ended only to call a tool", () => {
    const view = project([{ type: "assistant_end", text: "", stopReason: "toolUse" }]);
    expect(view.timeline).toEqual([]);
  });

  // The user's own Stop, and a provider failure that already reported itself as an error entry. Neither is the model
  // answering with nothing.
  it("stays silent for an aborted turn and for one that already reported an error", () => {
    expect(project([{ type: "assistant_end", text: "", stopReason: "aborted" }]).timeline).toEqual([]);
    expect(project([{ type: "assistant_end", text: "", stopReason: "error" }]).timeline).toEqual([]);
  });

  it("says nothing extra when the turn did produce text", () => {
    const view = project([
      { type: "assistant_delta", text: "alpha" },
      { type: "assistant_end", text: "alpha", stopReason: "stop" },
    ]);
    expect(view.timeline).toHaveLength(1);
    expect(view.timeline[0]).toMatchObject({ kind: "message", content: "alpha" });
  });

  it("keeps an empty view schema-valid", () => {
    expect(() => sessionViewSchema.parse(emptyPiSessionView("t1"))).not.toThrow();
  });

  it("appends a pending approval card for a gated tool call and settles it in place", () => {
    const pending = projectPiSessionView(emptyPiSessionView("t1"), {
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
    expect(() => sessionViewSchema.parse(pending)).not.toThrow();

    const settled = projectPiSessionView(pending, { type: "approval_settled", requestId: "r1", allowed: false });
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
    const settled = projectPiSessionView(view, { type: "approval_settled", requestId: "r2", allowed: true });
    expect(settled.timeline.map((item) => item.kind === "approval" && item.status)).toEqual(["pending", "allowed"]);
  });

  it("ignores a host_request that is not an approval, so chrome never enters the transcript", () => {
    const view = project([
      { type: "host_request", requestId: "r1", method: "setStatus", payload: { statusKey: "k", statusText: "busy" } },
      { type: "host_request", requestId: "r2", method: "confirm", payload: { title: "Allow?" } },
    ]);
    expect(view.timeline).toEqual([]);
  });

  it("marks an aborted turn stopped and goes idle, with no error item", () => {
    const view = project([
      { type: "assistant_delta", text: "half a th" },
      { type: "assistant_end", text: "half a th", stopReason: "aborted" },
    ]);
    expect(view.timeline).toHaveLength(1);
    expect(view.timeline[0]).toMatchObject({ kind: "message", status: "stopped", content: "half a th" });
    expect(view.phase).toBe("idle");
    expect(() => sessionViewSchema.parse(view)).not.toThrow();
  });

  it("adds no bubble when an aborted turn produced nothing", () => {
    const view = project([{ type: "assistant_end", text: "", stopReason: "aborted" }]);
    expect(view.timeline).toEqual([]);
    expect(view.phase).toBe("idle");
  });

  // A plugin's own payloads. They are transcript content, not model output, so they become their own item
  // kind rather than being folded into an assistant message.
  it("appends a data item for a plugin entry", () => {
    const view = project([{ type: "entry", entryId: "e2", customType: "my-plugin:card", data: { status: "ok" } }]);
    expect(view.timeline[0]).toMatchObject({ kind: "data", customType: "my-plugin:card", data: { status: "ok" } });
    expect(() => sessionViewSchema.parse(view)).not.toThrow();
  });

  it("appends a data item for a custom message and keeps its text", () => {
    const view = project([{ type: "custom_message", customType: "my-plugin", content: "status", details: { n: 1 } }]);
    expect(view.timeline[0]).toMatchObject({ kind: "data", customType: "my-plugin", text: "status", data: { n: 1 } });
    expect(() => sessionViewSchema.parse(view)).not.toThrow();
  });

  it("does not disturb a streaming assistant message when plugin data arrives mid-turn", () => {
    const view = project([
      { type: "assistant_delta", text: "thinking" },
      { type: "entry", entryId: "e9", customType: "probe", data: { tick: 1 } },
    ]);
    expect(view.timeline.map((item) => item.kind)).toEqual(["message", "data"]);
    expect(view.streamingAssistant?.content).toBe("thinking");
    expect(view.phase).toBe("model");
  });

  // The usage and context panels read these two fields and nothing else fills them: before this the drawer said
  // "no tools offered to the model" for a session that had just used one.
  it("puts the session's usage and request context where the panels read them, without touching the transcript", () => {
    const view = project([
      { type: "usage", usage: { requests: 2, inputTokens: 900, outputTokens: 120, costUsd: 0 } },
      {
        type: "request_context",
        context: {
          model: "qwen3-4b",
          contextTokens: 1200,
          contextWindow: 128000,
          maxOutputTokens: 4096,
          providerMaxOutputTokens: 0,
          systemPromptChars: 800,
          tools: [{ name: "listContainers", description: "list containers" }],
          messages: { user: 1, assistant: 2, toolCalls: 1 },
          compacted: false,
        },
      },
    ]);
    expect(view.usage).toMatchObject({ requests: 2, inputTokens: 900, outputTokens: 120 });
    expect(view.context?.tools).toEqual([
      {
        name: "listContainers",
        title: "listContainers",
        description: "list containers",
        group: "container",
        gated: false,
      },
    ]);
    expect(view.context?.totals.estimatedTokens).toBe(1200);
    expect(view.timeline).toEqual([]);
    expect(() => sessionViewSchema.parse(view)).not.toThrow();
  });

  it("ignores a settle for an approval it never saw", () => {
    const view = projectPiSessionView(emptyPiSessionView("t1"), {
      type: "approval_settled",
      requestId: "ghost",
      allowed: true,
    });
    expect(view.timeline).toEqual([]);
  });
});
