import { MAX_QUEUED_ASSISTANT_COMMANDS } from "@/ai-system/core/limits";
import { type AssistantCommandExecutionContext, planCommandExecution } from "./commandAvailability";
import type { AssistantCommandRegistry, AssistantCommandSource, AssistantInputParseResult } from "./commandTypes";
import { parseAssistantInput } from "./parseCommand";

type ParsedAssistantCommand = Extract<AssistantInputParseResult, { kind: "command" }>;

export interface QueuedAssistantCommand {
  queueId: number;
  commandId: string;
  canonicalInput: string;
  registryRevision: string;
  sourceIdentity: string;
  targetSessionId: string | null;
  enqueuedAt: number;
}

export type QueuedAssistantCommandValidation =
  | { kind: "execute"; command: ParsedAssistantCommand }
  | { kind: "queue"; reasonKey: string }
  | { kind: "unavailable"; reasonKey: string };

function sourceIdentity(source: AssistantCommandSource): string {
  switch (source.kind) {
    case "builtin":
      return "builtin";
    case "project-skill":
      return `${source.kind}:${source.workspaceId}:${source.fingerprint}`;
    case "plugin-skill":
      return `${source.kind}:${source.pluginId}:${source.fingerprint}`;
    // pi's own commands have no content to fingerprint: what a queued `/compact` means cannot change under it the
    // way a rewritten skill file can.
    case "pi-builtin":
      return source.kind;
    case "pi-plugin":
      return `${source.kind}:${source.pluginId}`;
    default:
      return `${source.kind}:${source.fingerprint}`;
  }
}

export function enqueueAssistantCommand(
  queue: readonly QueuedAssistantCommand[],
  queueId: number,
  command: ParsedAssistantCommand,
  registry: AssistantCommandRegistry,
  targetSessionId: string | null,
  enqueuedAt: number,
): QueuedAssistantCommand[] {
  if (queue.length >= MAX_QUEUED_ASSISTANT_COMMANDS) throw new Error("Command queue is full");
  const canonicalInput = `${command.command.path}${command.rawArguments ? ` ${command.rawArguments}` : ""}`;
  return [
    ...queue,
    {
      queueId,
      commandId: command.id,
      canonicalInput,
      registryRevision: registry.revision,
      sourceIdentity: sourceIdentity(command.command.source),
      targetSessionId,
      enqueuedAt,
    },
  ];
}

export function removeQueuedAssistantCommand(
  queue: readonly QueuedAssistantCommand[],
  queueId: number,
): QueuedAssistantCommand[] {
  return queue.filter((entry) => entry.queueId !== queueId);
}

export function revalidateQueuedAssistantCommand(
  entry: QueuedAssistantCommand,
  registry: AssistantCommandRegistry,
  context: AssistantCommandExecutionContext,
  activeSessionId: string | null,
): QueuedAssistantCommandValidation {
  if (entry.targetSessionId !== activeSessionId) {
    return { kind: "unavailable", reasonKey: "The queued command belongs to another Session" };
  }
  const definition = registry.commands.find((command) => command.id === entry.commandId);
  if (!definition || sourceIdentity(definition.source) !== entry.sourceIdentity) {
    return { kind: "unavailable", reasonKey: "The queued command is no longer available" };
  }
  const parsed = parseAssistantInput(entry.canonicalInput, registry);
  if (parsed.kind !== "command" || parsed.id !== entry.commandId) {
    return { kind: "unavailable", reasonKey: "The queued command is no longer valid" };
  }
  const execution = planCommandExecution(parsed.command, context);
  return execution.kind === "execute" ? { kind: "execute", command: parsed } : execution;
}
