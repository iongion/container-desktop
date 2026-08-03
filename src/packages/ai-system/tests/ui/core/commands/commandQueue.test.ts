import { describe, expect, it } from "vitest";
import { BUILTIN_ASSISTANT_COMMAND_REGISTRY } from "@/ai-system/ui/core/commands/commandCatalog";
import {
  enqueueAssistantCommand,
  removeQueuedAssistantCommand,
  revalidateQueuedAssistantCommand,
} from "@/ai-system/ui/core/commands/commandQueue";
import { createAssistantCommandRegistry } from "@/ai-system/ui/core/commands/commandRegistry";
import { parseAssistantInput } from "@/ai-system/ui/core/commands/parseCommand";

const parsedRename = () => {
  const parsed = parseAssistantInput("/thread rename Production", BUILTIN_ASSISTANT_COMMAND_REGISTRY);
  if (parsed.kind !== "command") throw new Error("test command did not parse");
  return parsed;
};

const context = (threadPhase: "idle" | "model" = "idle") => ({
  surface: "assistant" as const,
  hostStatus: "ready" as const,
  hasThread: true,
  threadPhase,
});

describe("Assistant command queue", () => {
  it("captures the canonical input, registry revision, source, and exact Thread", () => {
    expect(enqueueAssistantCommand([], 7, parsedRename(), BUILTIN_ASSISTANT_COMMAND_REGISTRY, "thread-1", 10)).toEqual([
      expect.objectContaining({
        queueId: 7,
        canonicalInput: "/thread rename Production",
        commandId: "thread.rename",
        registryRevision: "builtin-v8",
        sourceIdentity: "builtin",
        targetThreadId: "thread-1",
        enqueuedAt: 10,
      }),
    ]);
  });

  it("revalidates availability against current runtime state", () => {
    const entry = enqueueAssistantCommand([], 1, parsedRename(), BUILTIN_ASSISTANT_COMMAND_REGISTRY, "thread-1", 10)[0];

    expect(
      revalidateQueuedAssistantCommand(entry, BUILTIN_ASSISTANT_COMMAND_REGISTRY, context("model"), "thread-1"),
    ).toMatchObject({ kind: "queue" });
    expect(
      revalidateQueuedAssistantCommand(entry, BUILTIN_ASSISTANT_COMMAND_REGISTRY, context(), "thread-1"),
    ).toMatchObject({ kind: "execute", command: { id: "thread.rename", args: ["Production"] } });
  });

  it("fails closed after Thread, command, or source identity changes", () => {
    const entry = enqueueAssistantCommand([], 1, parsedRename(), BUILTIN_ASSISTANT_COMMAND_REGISTRY, "thread-1", 10)[0];
    const emptyRegistry = createAssistantCommandRegistry("empty", [[]]);

    expect(revalidateQueuedAssistantCommand(entry, BUILTIN_ASSISTANT_COMMAND_REGISTRY, context(), "thread-2")).toEqual({
      kind: "unavailable",
      reasonKey: "The queued command belongs to another Thread",
    });
    expect(revalidateQueuedAssistantCommand(entry, emptyRegistry, context(), "thread-1")).toEqual({
      kind: "unavailable",
      reasonKey: "The queued command is no longer available",
    });
  });

  it("removes only the requested queued command", () => {
    const queue = [
      ...enqueueAssistantCommand([], 1, parsedRename(), BUILTIN_ASSISTANT_COMMAND_REGISTRY, "thread-1", 10),
      ...enqueueAssistantCommand([], 2, parsedRename(), BUILTIN_ASSISTANT_COMMAND_REGISTRY, "thread-1", 11),
    ];

    expect(removeQueuedAssistantCommand(queue, 1).map(({ queueId }) => queueId)).toEqual([2]);
  });
});
