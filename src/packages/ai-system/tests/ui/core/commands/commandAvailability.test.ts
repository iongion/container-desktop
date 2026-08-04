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
      planCommandExecution(command("context.usage"), {
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
      planCommandExecution(command("session.new"), {
        surface: "assistant",
        hostStatus: "ready",
        hasThread: true,
        threadPhase: "tool",
      }),
    ).toEqual({ kind: "queue", reasonKey: "Wait for the active turn to finish" });
  });

  it("executes an idle command even when no Thread exists", () => {
    expect(
      planCommandExecution(command("session.new"), {
        surface: "assistant",
        hostStatus: "ready",
        hasThread: false,
        threadPhase: "idle",
      }),
    ).toEqual({ kind: "execute" });
  });

  it("reports semantic unavailability separately from scheduling", () => {
    expect(
      planCommandExecution(command("session.info"), {
        surface: "assistant",
        hostStatus: "ready",
        hasThread: false,
        threadPhase: "idle",
      }),
    ).toEqual({ kind: "unavailable", reasonKey: "Start or select a Thread first" });
    expect(
      planCommandExecution(command("turn.stop"), {
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
    expect(planCommandExecution(command("session.copy"), activeContext)).toEqual({ kind: "execute" });
  });

  // pi's own `/compact` is reported by the session, so the app declares nothing for it. What the app still owns is
  // the model picker, which cannot change under a running turn.
  it("keeps a configuration command to an idle turn", () => {
    expect(
      planCommandExecution(command("model.open"), {
        surface: "assistant",
        hostStatus: "ready",
        hasThread: true,
        threadPhase: "idle",
      }),
    ).toEqual({ kind: "execute" });
  });

  it("queues queued commands while the host connects and blocks normal commands after host failure", () => {
    expect(
      planCommandExecution(command("session.new"), {
        surface: "assistant",
        hostStatus: "connecting",
        hasThread: false,
        threadPhase: "idle",
      }),
    ).toEqual({ kind: "queue", reasonKey: "Wait for the Assistant to connect" });
    expect(
      planCommandExecution(command("session.new"), {
        surface: "assistant",
        hostStatus: "error",
        hasThread: false,
        threadPhase: "idle",
      }),
    ).toEqual({ kind: "unavailable", reasonKey: "The Assistant is unavailable" });
  });
});

// pi's own commands carry their own reason for being unavailable (see piSessionCommands.test.ts): the app's
// catalogue no longer declares a capability, because the commands that needed one were its own thread vocabulary and
// pi owns those concepts. The mechanism stays covered here, over a definition that declares one.
describe("session capabilities", () => {
  const base = { surface: "assistant", hostStatus: "ready", hasThread: true, threadPhase: "idle" } as const;

  it("refuses a command whose capability the session lacks, naming why", () => {
    const gated = { ...command("model.open"), capabilityId: "configuration" as const };
    expect(planCommandExecution(gated, { ...base, capabilities: new Set([]) })).toEqual({
      kind: "unavailable",
      reasonKey: "The model and access are chosen when the session starts",
    });
  });

  it("executes it where the session does carry the capability", () => {
    const gated = { ...command("model.open"), capabilityId: "configuration" as const };
    expect(planCommandExecution(gated, { ...base, capabilities: new Set(["configuration"]) })).toEqual({
      kind: "execute",
    });
  });

  // An unconstrained caller keeps the whole palette: absent means "not declared", not "nothing allowed".
  it("leaves a caller that declared no capabilities unconstrained", () => {
    expect(planCommandExecution(command("model.open"), base)).toEqual({ kind: "execute" });
  });
});
