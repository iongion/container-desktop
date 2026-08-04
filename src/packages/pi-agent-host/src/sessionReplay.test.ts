import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message, StopReason, Usage } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { replaySessionEntries, sessionWasCompacted } from "@/pi-agent-host/sessionReplay";

const USAGE: Usage = {
  input: 1,
  output: 2,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 3,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function user(text: string): Message {
  return { role: "user", content: [{ type: "text", text }], timestamp: 0 };
}

// pi's own AssistantMessage, with the fields its store round-trips. Built in full rather than cast, because the
// point of this suite is that the replay reads what pi actually persisted.
function reply(content: Extract<Message, { role: "assistant" }>["content"], stopReason: StopReason = "stop"): Message {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "container-desktop-gateway",
    model: "canned",
    usage: USAGE,
    stopReason,
    timestamp: 0,
  };
}

function toolResult(toolCallId: string, toolName: string, text: string, isError = false): Message {
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content: [{ type: "text", text }],
    details: { truncated: false },
    isError,
    timestamp: 0,
  };
}

// A real SessionManager writing a real JSONL, re-opened from disk: the entries the replay is handed are the ones pi
// persisted and parsed back, not literals shaped the way this suite hopes they look.
//
// pi writes NOTHING until the branch holds its first assistant message (`_persist`, session-manager.js), which is
// also why `/clone` refuses a session with no reply yet — so a fixture without one has to stay in memory.
function persistedBranch(write: (manager: SessionManager) => void) {
  const cwd = mkdtempSync(join(tmpdir(), "cd-pi-replay-cwd-"));
  const sessionDir = mkdtempSync(join(tmpdir(), "cd-pi-replay-sessions-"));
  const manager = SessionManager.create(cwd, sessionDir);
  write(manager);
  const file = manager.getSessionFile();
  if (!file) throw new Error("the session was not persisted");
  return SessionManager.open(file, sessionDir).getBranch();
}

// The same entries, before they reach a file. For a fixture pi would not persist — no assistant reply in it.
function branch(write: (manager: SessionManager) => void) {
  const manager = SessionManager.inMemory(mkdtempSync(join(tmpdir(), "cd-pi-replay-cwd-")));
  write(manager);
  return manager.getBranch();
}

describe("replaySessionEntries", () => {
  it("reads a persisted turn back as the events the live path emits for it", () => {
    const entries = persistedBranch((manager) => {
      manager.appendMessage(user("how many containers are running?"));
      manager.appendMessage(reply([{ type: "text", text: "Two." }]));
    });

    expect(replaySessionEntries(entries)).toEqual([
      { type: "user_message", text: "how many containers are running?" },
      { type: "assistant_end", text: "Two.", stopReason: "stop" },
    ]);
  });

  it("replays a tool call in the order the turn ran it: the assistant message, then the call, then its result", () => {
    const entries = persistedBranch((manager) => {
      manager.appendMessage(user("restart web"));
      manager.appendMessage(
        reply(
          [
            { type: "text", text: "Restarting." },
            { type: "toolCall", id: "call-1", name: "restartContainer", arguments: { id: "web" } },
          ],
          "toolUse",
        ),
      );
      manager.appendMessage(toolResult("call-1", "restartContainer", "restartContainer succeeded"));
      manager.appendMessage(reply([{ type: "text", text: "Done." }]));
    });

    expect(replaySessionEntries(entries)).toEqual([
      { type: "user_message", text: "restart web" },
      { type: "assistant_end", text: "Restarting.", stopReason: "toolUse" },
      { type: "tool_start", toolCallId: "call-1", toolName: "restartContainer", args: { id: "web" } },
      {
        type: "tool_end",
        toolCallId: "call-1",
        toolName: "restartContainer",
        isError: false,
        text: "restartContainer succeeded",
        details: { truncated: false },
      },
      { type: "assistant_end", text: "Done.", stopReason: "stop" },
    ]);
  });

  it("keeps a failed tool result a failure, so a replayed card is not green", () => {
    const entries = persistedBranch((manager) => {
      manager.appendMessage(
        reply([{ type: "toolCall", id: "call-9", name: "bash", arguments: { command: "false" } }], "toolUse"),
      );
      manager.appendMessage(toolResult("call-9", "bash", "Command exited with code 1", true));
    });

    const end = replaySessionEntries(entries).find((event) => event.type === "tool_end");
    expect(end).toMatchObject({ toolCallId: "call-9", isError: true, text: "Command exited with code 1" });
  });

  it("drops a thinking block, which the transcript never showed either", () => {
    const entries = persistedBranch((manager) => {
      manager.appendMessage(
        reply([
          { type: "thinking", thinking: "the user wants a count" },
          { type: "text", text: "Two." },
        ]),
      );
    });

    expect(replaySessionEntries(entries)).toEqual([{ type: "assistant_end", text: "Two.", stopReason: "stop" }]);
  });

  it("replays a plugin's own entry and message, and honours the one it asked to keep hidden", () => {
    const entries = branch((manager) => {
      manager.appendCustomEntry("review.findings", { count: 2 });
      manager.appendCustomMessageEntry("review.summary", "two findings", true, { severity: "low" });
      manager.appendCustomMessageEntry("review.context", "for the model only", false);
    });

    expect(replaySessionEntries(entries)).toEqual([
      { type: "entry", entryId: entries[0].id, customType: "review.findings", data: { count: 2 } },
      {
        type: "custom_message",
        customType: "review.summary",
        content: "two findings",
        details: { severity: "low" },
      },
    ]);
  });

  // pi's `!command` has no counterpart in this GUI, so an imported session is the only way one arrives — and a
  // message the transcript renders as nothing is a hole in the conversation the model still remembers.
  it("shows a shell execution a foreign session recorded", () => {
    const entries = branch((manager) => {
      manager.appendMessage({
        role: "bashExecution",
        command: "git status",
        output: "nothing to commit\n",
        exitCode: 0,
        cancelled: false,
        truncated: false,
        timestamp: 0,
      });
    });

    expect(replaySessionEntries(entries)).toEqual([
      {
        type: "custom_message",
        customType: "bashExecution",
        content: "git status\nnothing to commit\n",
        details: { exitCode: 0, cancelled: false, truncated: false },
      },
    ]);
  });

  // A compaction is not transcript content in this app — the live path only records that it happened — so replaying
  // one must add nothing, and the summarised turns it kept must still be replayed.
  it("adds nothing for pi's own bookkeeping entries", () => {
    const entries = branch((manager) => {
      const kept = manager.appendMessage(user("still here"));
      manager.appendModelChange("container-desktop-gateway", "canned");
      manager.appendThinkingLevelChange("low");
      manager.appendCompaction("everything before this", kept, 4321);
      manager.appendSessionInfo("a named session");
    });

    expect(replaySessionEntries(entries)).toEqual([{ type: "user_message", text: "still here" }]);
  });
});

describe("sessionWasCompacted", () => {
  it("is false for a conversation pi has never had to summarise", () => {
    const entries = branch((manager) => {
      manager.appendMessage(user("short enough"));
    });

    expect(sessionWasCompacted(entries)).toBe(false);
  });

  // The host holds this fact for the whole session, so a REPLACED session has to re-derive it: reporting the
  // predecessor's compaction would tell the user part of this conversation is a summary when none of it is.
  it("is true once pi has compacted the branch", () => {
    const entries = branch((manager) => {
      const kept = manager.appendMessage(user("still here"));
      manager.appendCompaction("everything before this", kept, 4321);
    });

    expect(sessionWasCompacted(entries)).toBe(true);
  });
});
