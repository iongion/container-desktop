import { describe, expect, it } from "vitest";

import { type CodingTranscriptItem, projectTranscript } from "@/ai-system/core/codingTranscript";
import type { BridgeEvent } from "@/pi-bridge/protocol";

const project = (events: BridgeEvent[]): CodingTranscriptItem[] =>
  events.reduce<CodingTranscriptItem[]>((items, event) => projectTranscript(items, event), []);

describe("projectTranscript", () => {
  it("accumulates assistant deltas into one streaming item", () => {
    const items = project([
      { type: "assistant_delta", text: "Hel" },
      { type: "assistant_delta", text: "lo" },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "assistant", text: "Hello", streaming: true });
  });

  it("settles the streaming item on assistant_end", () => {
    const items = project([
      { type: "assistant_delta", text: "Hi" },
      { type: "assistant_end", text: "Hi", stopReason: "stop" },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "assistant", text: "Hi", streaming: false });
  });

  it("starts a fresh assistant item after a settled one", () => {
    const items = project([
      { type: "assistant_delta", text: "one" },
      { type: "assistant_end", text: "one", stopReason: "stop" },
      { type: "assistant_delta", text: "two" },
    ]);
    expect(items.map((item) => (item as { text: string }).text)).toEqual(["one", "two"]);
  });

  it("tracks a tool call from running to ok", () => {
    const items = project([
      { type: "tool_start", toolCallId: "t1", toolName: "bash", args: { command: "ls" } },
      { type: "tool_update", toolCallId: "t1", text: "partial" },
      { type: "tool_end", toolCallId: "t1", toolName: "bash", isError: false, text: "done", details: { exitCode: 0 } },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "tool",
      toolName: "bash",
      output: "done",
      state: "ok",
      details: { exitCode: 0 },
    });
  });

  it("marks a failed tool call as error", () => {
    const items = project([
      { type: "tool_start", toolCallId: "t1", toolName: "bash", args: {} },
      { type: "tool_end", toolCallId: "t1", toolName: "bash", isError: true, text: "boom" },
    ]);
    expect(items[0]).toMatchObject({ kind: "tool", state: "error", output: "boom" });
  });

  it("appends an error item and closes any streaming assistant item", () => {
    const items = project([
      { type: "assistant_delta", text: "partial" },
      { type: "error", message: "model exploded" },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: "assistant", streaming: false });
    expect(items[1]).toMatchObject({ kind: "error", message: "model exploded" });
  });

  it("ignores events that carry no transcript content", () => {
    expect(project([{ type: "idle" }, { type: "turn_end" }])).toEqual([]);
  });

  it("ignores a tool update for an unknown tool call instead of throwing", () => {
    expect(project([{ type: "tool_update", toolCallId: "ghost", text: "x" }])).toEqual([]);
  });

  it("keeps a user item ahead of the assistant reply it triggered", () => {
    const withUser: CodingTranscriptItem[] = [{ kind: "user", id: "u1", text: "hello" }];
    const items = projectTranscript(withUser, { type: "assistant_delta", text: "hi" });
    expect(items.map((item) => item.kind)).toEqual(["user", "assistant"]);
  });
});
