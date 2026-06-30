import { describe, expect, it } from "vitest";

import type { AgentStreamEvent } from "@/ai-system/core";
import {
  hasPendingApproval,
  itemsFromMessages,
  messagesFromItems,
  reduceStreamEvent,
  setApprovalStatus,
  type TranscriptItem,
  userMessageItem,
} from "./transcript";

// Deterministic id minter for assertions.
function minter() {
  let n = 0;
  return () => `i${++n}`;
}

const delta = (text: string): AgentStreamEvent => ({ streamId: "s", type: "delta", payload: { text } });
const tool = (event: any): AgentStreamEvent => ({ streamId: "s", type: "tool", payload: { event } });
const done = (): AgentStreamEvent => ({ streamId: "s", type: "done", payload: { finishReason: "stop" } });

function feed(start: TranscriptItem[], events: AgentStreamEvent[]): TranscriptItem[] {
  const next = minter();
  return events.reduce((items, evt) => reduceStreamEvent(items, evt, next), start);
}

describe("reduceStreamEvent — the ordered Assistant timeline", () => {
  it("extends one streaming assistant bubble across consecutive deltas, then settles on done", () => {
    const items = feed([], [delta("Look"), delta("ing"), done()]);
    expect(items).toEqual([{ kind: "message", id: "i1", role: "assistant", content: "Looking", streaming: false }]);
  });

  it("keeps command, result and prose in arrival order (no bucketing)", () => {
    const items = feed(
      [userMessageItem("u", "why?")],
      [
        tool({ type: "command", program: "podman", args: ["ps"] }),
        tool({ type: "command-result", program: "podman", args: ["ps"], ok: true, stdout: "OK", stderr: "" }),
        delta("All good."),
        done(),
      ],
    );
    expect(items.map((i) => [i.kind, (i as any).content ?? (i as any).program ?? (i as any).stdout])).toEqual([
      ["message", "why?"],
      ["command", "podman"],
      ["command-result", "OK"],
      ["message", "All good."],
    ]);
  });

  it("orders a RESUMED turn correctly: prose → approval → result → more prose (the bug the seq fix solves)", () => {
    // Turn 1: the model asks for approval and stops; the card sits in the timeline.
    let items = feed(
      [userMessageItem("u", "stop web")],
      [
        delta("I need to run a command."),
        tool({
          type: "approval-request",
          actionId: "act-1",
          kind: "command",
          program: "podman",
          args: ["stop", "web"],
          reason: "changes state",
        }),
        done(),
      ],
    );
    // User approves; the broker runs it and resumes with the result + new prose.
    items = setApprovalStatus(items, "act-1", "allowed");
    items = feed(items, [
      tool({
        type: "command-result",
        program: "podman",
        args: ["stop", "web"],
        ok: true,
        stdout: "web stopped",
        stderr: "",
      }),
      delta("Done — web is stopped."),
      done(),
    ]);
    expect(items.map((i) => i.kind)).toEqual(["message", "message", "approval", "command-result", "message"]);
    const lastMsg = items.at(-1) as Extract<TranscriptItem, { kind: "message" }>;
    expect(lastMsg.content).toBe("Done — web is stopped.");
    expect((items[2] as any).status).toBe("allowed");
  });

  it("records a pending approval card and reports it pending", () => {
    const items = feed(
      [],
      [
        tool({
          type: "approval-request",
          actionId: "act-9",
          kind: "web",
          program: "web search",
          args: ["q"],
          reason: "r",
        }),
      ],
    );
    expect(items[0]).toMatchObject({ kind: "approval", actionId: "act-9", cmdKind: "web", status: "pending" });
    expect(hasPendingApproval(items)).toBe(true);
    expect(hasPendingApproval(setApprovalStatus(items, "act-9", "rejected"))).toBe(false);
  });

  it("appends a settled error item and stops streaming", () => {
    const items = feed([], [delta("partial"), { streamId: "s", type: "error", payload: { message: "boom" } }]);
    expect(items.map((i) => i.kind)).toEqual(["message", "error"]);
    expect((items[0] as any).streaming).toBe(false);
    expect((items[1] as any).message).toBe("boom");
  });

  it("round-trips messages ↔ items (only prose persists)", () => {
    const items: TranscriptItem[] = [
      userMessageItem("u", "hi"),
      { kind: "command", id: "c", program: "podman", args: ["ps"] },
      { kind: "message", id: "a", role: "assistant", content: "hello", streaming: false },
    ];
    const messages = messagesFromItems(items);
    expect(messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "hi"],
      ["assistant", "hello"],
    ]);
    expect(itemsFromMessages(messages).map((i) => i.kind)).toEqual(["message", "message"]);
  });
});

describe("reduceStreamEvent — typed first-class tools (generative-UI cards)", () => {
  it("appends a running tool item on tool-call, then fills it on tool-result", () => {
    const items = feed(
      [],
      [
        tool({ type: "tool-call", tool: "listContainers", title: "List containers", args: { all: true } }),
        tool({ type: "tool-result", tool: "listContainers", title: "", ok: true, result: [{ Id: "a" }] }),
      ],
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "tool",
      tool: "listContainers",
      title: "List containers",
      status: "complete",
      ok: true,
    });
    expect((items[0] as any).result).toEqual([{ Id: "a" }]);
  });

  it("marks a failed tool result as error status", () => {
    const items = feed(
      [],
      [
        tool({ type: "tool-call", tool: "removeContainer", title: "Remove", args: { id: "x" } }),
        tool({ type: "tool-result", tool: "removeContainer", title: "", ok: false, result: { message: "no such" } }),
      ],
    );
    expect(items[0]).toMatchObject({ kind: "tool", status: "error", ok: false });
  });

  it("keeps tool steps interleaved with prose in arrival order", () => {
    const items = feed(
      [userMessageItem("u", "list")],
      [
        delta("Listing…"),
        tool({ type: "tool-call", tool: "listContainers", title: "List containers", args: {} }),
        tool({ type: "tool-result", tool: "listContainers", title: "", ok: true, result: [] }),
        delta(" Done."),
        done(),
      ],
    );
    expect(items.map((i) => i.kind)).toEqual(["message", "message", "tool", "message"]);
  });

  it("matches a result to the most recent running call of the same tool", () => {
    const items = feed(
      [],
      [
        tool({ type: "tool-call", tool: "getContainerLogs", title: "Logs a", args: { id: "a" } }),
        tool({ type: "tool-result", tool: "getContainerLogs", title: "", ok: true, result: "log-a" }),
        tool({ type: "tool-call", tool: "getContainerLogs", title: "Logs b", args: { id: "b" } }),
        tool({ type: "tool-result", tool: "getContainerLogs", title: "", ok: true, result: "log-b" }),
      ],
    );
    expect(items).toHaveLength(2);
    expect((items[0] as any).result).toBe("log-a");
    expect((items[1] as any).result).toBe("log-b");
  });

  it("appends a completed tool item if a result arrives with no running call (defensive)", () => {
    const items = feed([], [tool({ type: "tool-result", tool: "listImages", title: "Images", ok: true, result: [] })]);
    expect(items[0]).toMatchObject({ kind: "tool", tool: "listImages", status: "complete" });
  });
});
