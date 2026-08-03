import { describe, expect, it } from "vitest";

import { mapAgentEvent } from "@/pi-agent-host/events";

describe("mapAgentEvent", () => {
  it("maps a text delta to assistant_delta", () => {
    expect(
      mapAgentEvent({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "hel" },
      }),
    ).toEqual([{ type: "assistant_delta", text: "hel" }]);
  });

  it("drops a text_end update", () => {
    expect(
      mapAgentEvent({
        type: "message_update",
        assistantMessageEvent: { type: "text_end", content: "hello" },
      }),
    ).toEqual([]);
  });

  it("maps an assistant message_end to assistant_end with joined text", () => {
    expect(
      mapAgentEvent({
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "one " },
            { type: "thinking", thinking: "ignored" },
            { type: "text", text: "two" },
          ],
          stopReason: "stop",
        },
      }),
    ).toEqual([{ type: "assistant_end", text: "one two", stopReason: "stop" }]);
  });

  it("surfaces an errored assistant message instead of a silent empty reply", () => {
    expect(
      mapAgentEvent({
        type: "message_end",
        message: { role: "assistant", content: [], stopReason: "error", errorMessage: "402 insufficient credits" },
      }),
    ).toEqual([
      { type: "error", message: "402 insufficient credits" },
      { type: "assistant_end", text: "", stopReason: "error" },
    ]);
  });

  it("falls back to a generic message when an errored turn carries no error text", () => {
    expect(
      mapAgentEvent({ type: "message_end", message: { role: "assistant", content: [], stopReason: "error" } })[0],
    ).toEqual({ type: "error", message: "the model returned an error" });
  });

  it("ignores a user message_end", () => {
    expect(mapAgentEvent({ type: "message_end", message: { role: "user", content: [] } })).toEqual([]);
  });

  it("maps tool execution lifecycle events", () => {
    expect(
      mapAgentEvent({ type: "tool_execution_start", toolCallId: "t1", toolName: "bash", args: { command: "ls" } }),
    ).toEqual([{ type: "tool_start", toolCallId: "t1", toolName: "bash", args: { command: "ls" } }]);

    expect(
      mapAgentEvent({
        type: "tool_execution_update",
        toolCallId: "t1",
        toolName: "bash",
        partialResult: { content: [{ type: "text", text: "partial" }] },
      }),
    ).toEqual([{ type: "tool_update", toolCallId: "t1", text: "partial" }]);

    expect(
      mapAgentEvent({
        type: "tool_execution_end",
        toolCallId: "t1",
        toolName: "bash",
        isError: false,
        result: { content: [{ type: "text", text: "done" }], details: { exitCode: 0 } },
      }),
    ).toEqual([
      { type: "tool_end", toolCallId: "t1", toolName: "bash", isError: false, text: "done", details: { exitCode: 0 } },
    ]);
  });

  it("maps agent_settled to idle and turn_end to turn_end", () => {
    expect(mapAgentEvent({ type: "agent_settled" })).toEqual([{ type: "idle" }]);
    expect(mapAgentEvent({ type: "turn_end" })).toEqual([{ type: "turn_end" }]);
  });

  it("returns no events for anything unmapped", () => {
    expect(mapAgentEvent({ type: "queue_update" })).toEqual([]);
  });
});
