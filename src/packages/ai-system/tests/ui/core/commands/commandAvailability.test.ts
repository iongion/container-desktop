import { describe, expect, it } from "vitest";
import { PI_SESSION_CAPABILITIES } from "@/ai-system/core/piAIState";
import { planCommandExecution } from "@/ai-system/ui/core/commands/commandAvailability";
import { BUILTIN_ASSISTANT_COMMANDS } from "@/ai-system/ui/core/commands/commandCatalog";

const command = (id: string) => {
  const found = BUILTIN_ASSISTANT_COMMANDS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing command ${id}`);
  return found;
};

describe("planCommandExecution", () => {
  it("executes immediate UI while an Agent Session is active or the host is connecting", () => {
    expect(
      planCommandExecution(command("thread.list"), {
        surface: "assistant",
        hostStatus: "ready",
        hasThread: true,
        threadPhase: "model",
      }),
    ).toEqual({ kind: "execute" });
    expect(
      planCommandExecution(command("help"), {
        surface: "assistant",
        hostStatus: "connecting",
        hasThread: false,
        threadPhase: "idle",
      }),
    ).toEqual({ kind: "execute" });
  });

  it("queues state-changing commands while an Agent Session is active", () => {
    expect(
      planCommandExecution(command("thread.new"), {
        surface: "assistant",
        hostStatus: "ready",
        hasThread: true,
        threadPhase: "tool",
      }),
    ).toEqual({ kind: "queue", reasonKey: "Wait for the active turn to finish" });
  });

  it("executes an idle command even when no Thread exists", () => {
    expect(
      planCommandExecution(command("thread.new"), {
        surface: "assistant",
        hostStatus: "ready",
        hasThread: false,
        threadPhase: "idle",
      }),
    ).toEqual({ kind: "execute" });
  });

  it("reports semantic unavailability separately from scheduling", () => {
    expect(
      planCommandExecution(command("thread.rename"), {
        surface: "assistant",
        hostStatus: "ready",
        hasThread: false,
        threadPhase: "idle",
      }),
    ).toEqual({ kind: "unavailable", reasonKey: "Start or select a Thread first" });
    expect(
      planCommandExecution(command("thread.stop"), {
        surface: "assistant",
        hostStatus: "ready",
        hasThread: true,
        threadPhase: "idle",
      }),
    ).toEqual({ kind: "unavailable", reasonKey: "No active turn to stop" });
  });

  it("keeps model selection idle-only while allowing side-effect-free copy during a turn", () => {
    const activeContext = {
      surface: "assistant" as const,
      hostStatus: "ready" as const,
      hasThread: true,
      threadPhase: "model" as const,
    };
    expect(planCommandExecution(command("model.open"), activeContext)).toEqual({
      kind: "unavailable",
      reasonKey: "Wait for the active turn to finish",
    });
    expect(planCommandExecution(command("thread.copy"), activeContext)).toEqual({ kind: "execute" });
  });

  it("opens Thread compaction only for an idle Thread", () => {
    expect(
      planCommandExecution(command("thread.compact"), {
        surface: "assistant",
        hostStatus: "ready",
        hasThread: true,
        threadPhase: "idle",
      }),
    ).toEqual({ kind: "execute" });
    expect(
      planCommandExecution(command("thread.compact"), {
        surface: "assistant",
        hostStatus: "ready",
        hasThread: true,
        threadPhase: "model",
      }),
    ).toEqual({ kind: "unavailable", reasonKey: "Wait for the active turn to finish" });
  });

  it("queues queued commands while the host connects and blocks normal commands after host failure", () => {
    expect(
      planCommandExecution(command("thread.new"), {
        surface: "assistant",
        hostStatus: "connecting",
        hasThread: false,
        threadPhase: "idle",
      }),
    ).toEqual({ kind: "queue", reasonKey: "Wait for the Assistant to connect" });
    expect(
      planCommandExecution(command("thread.new"), {
        surface: "assistant",
        hostStatus: "error",
        hasThread: false,
        threadPhase: "idle",
      }),
    ).toEqual({ kind: "unavailable", reasonKey: "The Assistant is unavailable" });
  });
});

// A session that cannot do a thing must SAY so before the command runs. The pi session is one conversation:
// it has no thread list, cannot rewrite its own history, and takes its model and access at start — so those
// commands used to be offered, accepted, and only then rejected from deep inside the store.
describe("session capabilities", () => {
  const base = { surface: "assistant", hostStatus: "ready", hasThread: true, threadPhase: "idle" } as const;

  it("refuses a command the session has no capability for, naming why", () => {
    for (const [id, reason] of [
      ["thread.new", "This session cannot start a new conversation"],
      ["thread.rename", "This session is a single conversation"],
      ["thread.branch", "This session cannot revisit its history"],
      ["thread.compact", "This session cannot revisit its history"],
      ["access.set", "The model and access are chosen when the session starts"],
      ["reasoning.set", "The model and access are chosen when the session starts"],
    ] as const) {
      expect(planCommandExecution(command(id), { ...base, capabilities: new Set() })).toEqual({
        kind: "unavailable",
        reasonKey: reason,
      });
    }
  });

  it("executes those same commands where the session does carry the capability", () => {
    const capabilities = new Set(["conversation-reset", "threads", "history", "configuration"] as const);
    for (const id of ["thread.new", "thread.branch", "access.set"]) {
      expect(planCommandExecution(command(id), { ...base, capabilities })).toEqual({ kind: "execute" });
    }
  });

  // The set a pi session really publishes: it can start a FRESH conversation (a fresh session), but it still
  // has no second conversation to list, switch to, rename or delete.
  it("matches what a pi session can actually do", () => {
    const capabilities = PI_SESSION_CAPABILITIES;
    expect(planCommandExecution(command("thread.new"), { ...base, capabilities })).toEqual({ kind: "execute" });
    expect(planCommandExecution(command("thread.rename"), { ...base, capabilities })).toEqual({
      kind: "unavailable",
      reasonKey: "This session is a single conversation",
    });
  });

  // Stopping a turn is not a capability the session can lack — there is always an abort.
  it("leaves capability-free commands alone", () => {
    expect(
      planCommandExecution(command("thread.stop"), { ...base, threadPhase: "model", capabilities: new Set() }),
    ).toEqual({
      kind: "execute",
    });
    expect(planCommandExecution(command("help"), { ...base, capabilities: new Set() })).toEqual({ kind: "execute" });
  });

  // Omitting the set entirely must not silently hide half the palette for callers that never opted in.
  it("treats an absent capability set as 'everything is available'", () => {
    expect(planCommandExecution(command("thread.new"), base)).toEqual({ kind: "execute" });
  });
});
