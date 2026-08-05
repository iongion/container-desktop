import { describe, expect, it } from "vitest";
import { BUILTIN_ASSISTANT_COMMAND_REGISTRY } from "@/ai-system/ui/core/commands/commandCatalog";
import {
  enqueueAssistantCommand,
  removeQueuedAssistantCommand,
  revalidateQueuedAssistantCommand,
} from "@/ai-system/ui/core/commands/commandQueue";
import { createAssistantCommandRegistry } from "@/ai-system/ui/core/commands/commandRegistry";
import { parseAssistantInput } from "@/ai-system/ui/core/commands/parseCommand";

// A queued command — one that waits for an idle turn — is what the queue exists for. `/new` is pi's own name for
// starting a fresh session, and the app performs it.
const parsedQueued = () => {
  const parsed = parseAssistantInput("/new", BUILTIN_ASSISTANT_COMMAND_REGISTRY);
  if (parsed.kind !== "command") throw new Error("test command did not parse");
  return parsed;
};

const context = (sessionPhase: "idle" | "model" = "idle") => ({
  surface: "assistant" as const,
  hostStatus: "ready" as const,
  hasSession: true,
  sessionPhase,
});

describe("Assistant command queue", () => {
  it("captures the canonical input, registry revision, source, and exact Session", () => {
    expect(enqueueAssistantCommand([], 7, parsedQueued(), BUILTIN_ASSISTANT_COMMAND_REGISTRY, "session-1", 10)).toEqual(
      [
        expect.objectContaining({
          queueId: 7,
          canonicalInput: "/new",
          commandId: "session.new",
          registryRevision: "builtin-v12",
          sourceIdentity: "builtin",
          targetSessionId: "session-1",
          enqueuedAt: 10,
        }),
      ],
    );
  });

  it("revalidates availability against current runtime state", () => {
    const entry = enqueueAssistantCommand(
      [],
      1,
      parsedQueued(),
      BUILTIN_ASSISTANT_COMMAND_REGISTRY,
      "session-1",
      10,
    )[0];

    expect(
      revalidateQueuedAssistantCommand(entry, BUILTIN_ASSISTANT_COMMAND_REGISTRY, context("model"), "session-1"),
    ).toMatchObject({ kind: "queue" });
    expect(
      revalidateQueuedAssistantCommand(entry, BUILTIN_ASSISTANT_COMMAND_REGISTRY, context(), "session-1"),
    ).toMatchObject({ kind: "execute", command: { id: "session.new", args: [] } });
  });

  it("fails closed after Session, command, or source identity changes", () => {
    const entry = enqueueAssistantCommand(
      [],
      1,
      parsedQueued(),
      BUILTIN_ASSISTANT_COMMAND_REGISTRY,
      "session-1",
      10,
    )[0];
    const emptyRegistry = createAssistantCommandRegistry("empty", [[]]);

    expect(revalidateQueuedAssistantCommand(entry, BUILTIN_ASSISTANT_COMMAND_REGISTRY, context(), "session-2")).toEqual(
      {
        kind: "unavailable",
        reasonKey: "The queued command belongs to another Session",
      },
    );
    expect(revalidateQueuedAssistantCommand(entry, emptyRegistry, context(), "session-1")).toEqual({
      kind: "unavailable",
      reasonKey: "The queued command is no longer available",
    });
  });

  it("removes only the requested queued command", () => {
    const queue = [
      ...enqueueAssistantCommand([], 1, parsedQueued(), BUILTIN_ASSISTANT_COMMAND_REGISTRY, "session-1", 10),
      ...enqueueAssistantCommand([], 2, parsedQueued(), BUILTIN_ASSISTANT_COMMAND_REGISTRY, "session-1", 11),
    ];

    expect(removeQueuedAssistantCommand(queue, 1).map(({ queueId }) => queueId)).toEqual([2]);
  });
});
