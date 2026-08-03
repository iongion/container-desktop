import { describe, expect, it } from "vitest";
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
    expect(planCommandExecution(command("run.stop"), activeContext)).toEqual({ kind: "execute" });
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
