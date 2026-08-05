// What the app should do about the assistant's session on boot.
//
// The rule the whole design exists for: the user is asked to start a session ONCE, and only when there is nothing
// usable to adopt. Every boot after that continues what is already there. This module is the decision alone — pure,
// so it can be driven by fixtures rather than by an engine — and the caller performs it.

import type { AIDefaultSessionConfig } from "./types";

// What discovery found on one connection. `complete` is both halves of the pair standing; the reaper has already
// cleared a lone half by the time this runs, so an incomplete entry means "rebuild", never "resume".
export interface DefaultSessionCandidate {
  connectionId: string;
  complete: boolean;
  running: boolean;
}

export type DefaultSessionPlan =
  // Reattach to a session that never stopped. The conversation is still in the container.
  | { kind: "adopt"; connectionId: string }
  // Its containers are standing but stopped: starting them keeps the conversation, so continuing is the offer.
  | { kind: "resume"; connectionIds: string[] }
  // Configured, with nothing left standing to adopt. Everything needed is known, so no question is asked.
  | { kind: "create"; connectionId: string }
  // The one permitted question. Whatever could be answered for the user already has been: `ready` says the form
  // needs nothing but a confirmation.
  | { kind: "configure"; connectionId?: string; workspacePath?: string; ready: boolean };

export interface DefaultSessionInput {
  // Only a connected engine can be acted on — adopting, resuming and rebuilding all run a command against it.
  connections: readonly { id: string; connected: boolean }[];
  configured?: Record<string, AIDefaultSessionConfig>;
  discovered?: readonly DefaultSessionCandidate[];
  // The folder the app already knows the user works in. The one input that is never guessed, only inherited.
  workspaceRoot?: string;
}

export function planDefaultSession(input: DefaultSessionInput): DefaultSessionPlan {
  const reachable = new Set(input.connections.filter((connection) => connection.connected).map(({ id }) => id));
  const candidates = (input.discovered ?? []).filter(({ connectionId }) => reachable.has(connectionId));

  const running = candidates.find(({ complete, running }) => complete && running);
  if (running) return { kind: "adopt", connectionId: running.connectionId };

  const stopped = candidates.filter(({ complete, running }) => complete && !running);
  if (stopped.length > 0) return { kind: "resume", connectionIds: stopped.map(({ connectionId }) => connectionId) };

  // Nothing standing. A connection the user already configured is rebuilt in silence — the configuration is the
  // answer they gave the one time they were asked.
  const configured = Object.keys(input.configured ?? {}).find((connectionId) => reachable.has(connectionId));
  if (configured) return { kind: "create", connectionId: configured };

  // The one question. With a single engine there is nothing to choose, and with a known workspace nothing to type.
  const only = reachable.size === 1 ? [...reachable][0] : undefined;
  const workspacePath = input.workspaceRoot;
  return {
    kind: "configure",
    ...(only ? { connectionId: only } : {}),
    ...(workspacePath ? { workspacePath } : {}),
    ready: !!only && !!workspacePath,
  };
}
