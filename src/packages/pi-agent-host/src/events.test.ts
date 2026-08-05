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

  // An abort is a user decision, not a model failure: pi reports stopReason "aborted" with an
  // errorMessage, and turning that into an error item puts a red callout on the user's own Stop or Reject.
  it("reports an aborted turn as aborted rather than as an error", () => {
    expect(
      mapAgentEvent({
        type: "message_end",
        message: { role: "assistant", content: [], stopReason: "aborted", errorMessage: "Request aborted" },
      }),
    ).toEqual([{ type: "assistant_end", text: "", stopReason: "aborted" }]);
  });

  it("keeps partial text from an aborted turn", () => {
    expect(
      mapAgentEvent({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "half a th" }], stopReason: "aborted" },
      }),
    ).toEqual([{ type: "assistant_end", text: "half a th", stopReason: "aborted" }]);
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

  // What a plugin publishes for the GUI. pi.appendEntry emits a first-class `entry_appended` session event
  // carrying a CustomEntry, so no session polling is needed to see it.
  it("maps a plugin's appended entry to an entry event", () => {
    expect(
      mapAgentEvent({
        type: "entry_appended",
        entry: { id: "e2", type: "custom", customType: "my-plugin:card", data: { status: "ok" } },
      }),
    ).toEqual([{ type: "entry", entryId: "e2", customType: "my-plugin:card", data: { status: "ok" } }]);
  });

  it("ignores an appended entry that carries no customType, which is pi's own bookkeeping", () => {
    expect(mapAgentEvent({ type: "entry_appended", entry: { id: "e3", type: "message" } })).toEqual([]);
  });

  // pi.sendMessage produces a message with role "custom", and the agent loop emits message_end for it.
  it("maps a custom message to a custom_message event", () => {
    expect(
      mapAgentEvent({
        type: "message_end",
        message: {
          role: "custom",
          customType: "my-plugin",
          content: [{ type: "text", text: "status" }],
          details: { n: 1 },
        },
      }),
    ).toEqual([{ type: "custom_message", customType: "my-plugin", content: "status", details: { n: 1 } }]);
  });

  it("accepts a custom message whose content is a plain string, which pi's type allows", () => {
    expect(
      mapAgentEvent({ type: "message_end", message: { role: "custom", customType: "p", content: "just text" } }),
    ).toEqual([{ type: "custom_message", customType: "p", content: "just text", details: undefined }]);
  });

  it("drops a custom message with no customType rather than emitting an unlabelled card", () => {
    expect(mapAgentEvent({ type: "message_end", message: { role: "custom", content: "x" } })).toEqual([]);
  });

  // display:false is a plugin feeding the model, not the user — putting it in the transcript would show
  // context the plugin asked to keep out of it.
  it("drops a custom message the plugin marked as not for display", () => {
    expect(
      mapAgentEvent({
        type: "message_end",
        message: { role: "custom", customType: "p", content: "x", display: false },
      }),
    ).toEqual([]);
  });
});
