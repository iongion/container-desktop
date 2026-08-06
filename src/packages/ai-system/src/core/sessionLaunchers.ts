// The rows the assistant's launcher shows: what can be started, continued or resumed, and on which connection.
//
// This is the bootstrap made explicit. A connection the user has already configured is their own decision and comes
// first; a connection with nothing configured still gets an offered default, built from what the app already knows,
// so there is always something to click rather than a form to complete. Pure, so the launcher's behaviour is settled
// here rather than in a component.

import type { AIDefaultSessionConfig } from "./types";

export interface DefaultSessionCandidate {
  connectionId: string;
  running: boolean;
}

export type SessionLauncherState = "running" | "stopped" | "absent";
// Continue the session that exists, start the one that does not. Whether its container happens to be up or merely
// stopped is the engine's business, not something the user should have to hold a second verb for: both mean "take me
// back to my conversation", and both do. The STATE is still kept apart, because bringing a stopped container up is real
// work that has to happen before it can be dialled.
export type SessionLauncherAction = "continue" | "start";

export interface SessionLauncher {
  connectionId: string;
  name: string;
  // An offered default, rather than something the user configured and named.
  isDefault: boolean;
  workspacePath: string;
  modelId?: string;
  state: SessionLauncherState;
  action: SessionLauncherAction;
  egress: boolean;
}

// The engine this app favours. Where it OFFERS a default rather than following a choice the user already made, it
// offers podman — and falls back to whatever else is running. Only ever about the offer: a session the user
// configured themselves keeps their own order.
const FAVOURED_ENGINE = "podman";

export interface SessionLauncherInput {
  connections: readonly { id: string; connected: boolean; engine?: string }[];
  configured?: Record<string, AIDefaultSessionConfig>;
  discovered?: readonly DefaultSessionCandidate[];
  // The folder the app already knows the user works in, which is what makes an unconfigured connection offerable.
  workspaceRoot?: string;
}

// Nothing found means nothing to adopt, which reads as absent: starting builds it under the same name.
function stateOf(candidate: DefaultSessionCandidate | undefined): SessionLauncherState {
  if (!candidate) return "absent";
  return candidate.running ? "running" : "stopped";
}

const ACTIONS: Record<SessionLauncherState, SessionLauncherAction> = {
  running: "continue",
  stopped: "continue",
  absent: "start",
};

function launcherFor(
  connectionId: string,
  config: AIDefaultSessionConfig | undefined,
  candidate: DefaultSessionCandidate | undefined,
  workspaceRoot: string | undefined,
): SessionLauncher | undefined {
  // Without a folder there is nothing to mount, so there is nothing to offer: that connection needs the one question
  // answered before it can appear at all.
  const workspacePath = config?.workspacePath ?? workspaceRoot;
  if (!workspacePath) return undefined;
  const state = stateOf(candidate);
  return {
    connectionId,
    name: config?.name ?? "Default",
    isDefault: !config?.name,
    workspacePath,
    ...(config?.modelId ? { modelId: config.modelId } : {}),
    state,
    action: ACTIONS[state],
    egress: config?.egress ?? true,
  };
}

export function sessionLaunchers(input: SessionLauncherInput): SessionLauncher[] {
  const reachable = input.connections.filter((connection) => connection.connected);
  const candidate = (connectionId: string) =>
    (input.discovered ?? []).find((entry) => entry.connectionId === connectionId);
  const build = (connectionId: string, config?: AIDefaultSessionConfig) =>
    launcherFor(connectionId, config, candidate(connectionId), input.workspaceRoot);

  const configured = reachable
    .filter((connection) => input.configured?.[connection.id])
    .map((connection) => build(connection.id, input.configured?.[connection.id]));
  const offered = reachable
    .filter((connection) => !input.configured?.[connection.id])
    // The favoured engine first. `sort` is stable, so everything else keeps the order the connections arrived in.
    .slice()
    .sort((left, right) => Number(right.engine === FAVOURED_ENGINE) - Number(left.engine === FAVOURED_ENGINE))
    .map((connection) => build(connection.id));

  return [...configured, ...offered].filter((row): row is SessionLauncher => !!row);
}
