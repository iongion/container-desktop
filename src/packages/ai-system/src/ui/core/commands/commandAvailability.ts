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

// Whether a MOUSE CLICK on a palette row should run the command outright rather than write it into the composer.
// Clicking a row is a commitment in a way that arrowing onto it is not — the keyboard keeps inserting, because there
// the row under the cursor is just where you happen to be. A click only runs a command that needs nothing further
// from the user: one with required arguments has nothing to run yet, and one that asks to be confirmed must not have
// a single-gesture path to doing the very thing it wanted confirmed.
export function runsOnPointerActivation(command: AssistantCommandDefinition): boolean {
  if (command.confirmation !== "none") return false;
  switch (command.arguments.kind) {
    case "none":
      return true;
    case "text":
      return !command.arguments.required;
    case "tokens":
      return command.arguments.min === 0;
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
