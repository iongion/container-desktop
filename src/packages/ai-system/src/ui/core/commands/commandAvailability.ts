import type { ThreadPhase } from "@/ai-system/core/threadEvents";

import type { AssistantCommandCapabilityId, AssistantCommandDefinition, AssistantCommandSurface } from "./commandTypes";

export interface AssistantCommandExecutionContext {
  surface: AssistantCommandSurface;
  hostStatus: "connecting" | "ready" | "error";
  hasThread: boolean;
  threadPhase: ThreadPhase;
  // What THIS session can do. Absent ⇒ unconstrained, so a caller that never opted in keeps the whole palette.
  capabilities?: ReadonlySet<AssistantCommandCapabilityId>;
}

export type AssistantCommandExecutionPlan =
  | { kind: "execute" }
  | { kind: "queue"; reasonKey: string }
  | { kind: "unavailable"; reasonKey: string };

function activeTurn(phase: ThreadPhase): boolean {
  return phase !== "idle" && phase !== "error";
}

// Why a session cannot run a command at all, however idle it is. Separate from the phase and surface reasons
// because this answer does not change while the session lives.
const CAPABILITY_REASON: Record<AssistantCommandCapabilityId, string> = {
  "conversation-reset": "This session cannot start a new conversation",
  threads: "This session is a single conversation",
  history: "This session cannot revisit its history",
  configuration: "The model and access are chosen when the session starts",
};

function semanticUnavailableReason(
  command: AssistantCommandDefinition,
  context: AssistantCommandExecutionContext,
): string | undefined {
  if (!command.surfaces.includes(context.surface)) return "Command is not available here";
  if (command.capabilityId && context.capabilities && !context.capabilities.has(command.capabilityId)) {
    return CAPABILITY_REASON[command.capabilityId];
  }
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
