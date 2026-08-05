import type { SessionPhase } from "@/ai-system/core/sessionEvents";

import type { AssistantCommandDefinition, AssistantCommandSurface } from "./commandTypes";

export interface AssistantCommandExecutionContext {
  surface: AssistantCommandSurface;
  hostStatus: "connecting" | "ready" | "error";
  hasSession: boolean;
  sessionPhase: SessionPhase;
}

export type AssistantCommandExecutionPlan =
  | { kind: "execute" }
  | { kind: "queue"; reasonKey: string }
  | { kind: "unavailable"; reasonKey: string };

function activeTurn(phase: SessionPhase): boolean {
  return phase !== "idle" && phase !== "error";
}

function semanticUnavailableReason(
  command: AssistantCommandDefinition,
  context: AssistantCommandExecutionContext,
): string | undefined {
  if (!command.surfaces.includes(context.surface)) return "Command is not available here";
  // pi's own command, offered so a user who knows pi can find it, with the reason this architecture cannot honour
  // it. Refused HERE rather than accepted and then failed from inside a store.
  if (command.kind === "pi" && command.venue === "unavailable") {
    return command.unavailableReason ?? "This session cannot run that pi command";
  }
  switch (command.availabilityId) {
    case "session":
    case "session-idle":
      return context.hasSession ? undefined : "Start or select a Session first";
    case "session-idle-only":
      if (!context.hasSession) return "Start or select a Session first";
      return activeTurn(context.sessionPhase) ? "Wait for the active turn to finish" : undefined;
    case "session-active":
      return context.hasSession && activeTurn(context.sessionPhase) ? undefined : "No active turn to stop";
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
  if (activeTurn(context.sessionPhase) && command.bypassTier === "queued") {
    return { kind: "queue", reasonKey: "Wait for the active turn to finish" };
  }
  return { kind: "execute" };
}
