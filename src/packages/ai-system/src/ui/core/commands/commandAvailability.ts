import type { ThreadPhase } from "@/ai-system/core/threadEvents";

import type { AssistantCommandDefinition, AssistantCommandSurface } from "./commandTypes";

export interface AssistantCommandExecutionContext {
  surface: AssistantCommandSurface;
  hostStatus: "connecting" | "ready" | "error";
  hasThread: boolean;
  threadPhase: ThreadPhase;
}

export type AssistantCommandExecutionPlan =
  | { kind: "execute" }
  | { kind: "queue"; reasonKey: string }
  | { kind: "unavailable"; reasonKey: string };

function activeTurn(phase: ThreadPhase): boolean {
  return phase !== "idle" && phase !== "error";
}

function semanticUnavailableReason(
  command: AssistantCommandDefinition,
  context: AssistantCommandExecutionContext,
): string | undefined {
  if (!command.surfaces.includes(context.surface)) return "Command is not available here";
  switch (command.availabilityId) {
    case "thread":
    case "thread-idle":
      return context.hasThread ? undefined : "Start or select a Thread first";
    case "thread-idle-only":
      if (!context.hasThread) return "Start or select a Thread first";
      return activeTurn(context.threadPhase) ? "Wait for the active turn to finish" : undefined;
    case "thread-active":
      return context.hasThread && activeTurn(context.threadPhase) ? undefined : "No active turn to stop";
    case "assistant-only":
      return context.surface === "assistant" ? undefined : "Open the Assistant to use this command";
    case "quake-console-only":
      return context.surface === "quake-console" ? undefined : "Open the Assistant console to use this command";
    default:
      return undefined;
  }
}

export function planCommandExecution(
  command: AssistantCommandDefinition,
  context: AssistantCommandExecutionContext,
): AssistantCommandExecutionPlan {
  const unavailable = semanticUnavailableReason(command, context);
  if (unavailable) return { kind: "unavailable", reasonKey: unavailable };

  if (context.hostStatus === "error") {
    return command.bypassTier === "always" || command.bypassTier === "immediate-ui"
      ? { kind: "execute" }
      : { kind: "unavailable", reasonKey: "The Assistant is unavailable" };
  }
  if (context.hostStatus === "connecting") {
    if (["always", "connecting", "immediate-ui"].includes(command.bypassTier)) return { kind: "execute" };
    if (command.bypassTier === "queued") return { kind: "queue", reasonKey: "Wait for the Assistant to connect" };
    return { kind: "unavailable", reasonKey: "Wait for the Assistant to connect" };
  }
  if (activeTurn(context.threadPhase) && command.bypassTier === "queued") {
    return { kind: "queue", reasonKey: "Wait for the active turn to finish" };
  }
  return { kind: "execute" };
}
