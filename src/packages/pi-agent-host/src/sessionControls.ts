// The four things pi's own commands act on besides the conversation itself: the sessions this workspace has on
// disk, the project-trust decision, the runtime settings, and the models a session can cycle through.
//
// Each is a thin adapter over pi's own store or session, kept out of `session.ts` so the wiring there stays the
// runtime and the event plumbing. Every one reads through a getter rather than holding a session, because a
// replacement swaps the session underneath and an adapter bound to the old one would answer for a conversation
// nobody can see.

import type { ThinkingLevel } from "@earendil-works/pi-ai";
import {
  type AgentSession,
  type AgentSessionServices,
  hasTrustRequiringProjectResources,
  ProjectTrustStore,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

import type { PiProjectTrust, PiScopedModels, PiSessionSettings, PiSessionSummary } from "@/pi-bridge/protocol";

// Enough of a first message to recognise the conversation in a list. pi's own `SessionInfo` also carries
// `allMessagesText` — the WHOLE conversation, for its search — which is exactly why this is projected.
const PREVIEW_LENGTH = 120;

function preview(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > PREVIEW_LENGTH ? `${line.slice(0, PREVIEW_LENGTH - 1)}…` : line;
}

export interface WorkspaceSessionsOptions {
  cwd: string;
  // Read off the LIVE session manager, never recomputed: pi does not export `getDefaultSessionDir`, and guessing
  // its path scheme would list the wrong directory the moment pi changed it.
  sessionDir: () => string;
  currentPath: () => string | undefined;
}

export function createWorkspaceSessions(options: WorkspaceSessionsOptions) {
  return async function listWorkspaceSessions(): Promise<PiSessionSummary[]> {
    const current = options.currentPath();
    const sessions = await SessionManager.list(options.cwd, options.sessionDir());
    return (
      sessions
        .map((session) => ({
          path: session.path,
          id: session.id,
          ...(session.name ? { name: session.name } : {}),
          modified: session.modified.toISOString(),
          messageCount: session.messageCount,
          firstMessage: preview(session.firstMessage),
          current: session.path === current,
        }))
        // Newest first: the one you were just in is the one you are most likely coming back to.
        .sort((left, right) => right.modified.localeCompare(left.modified))
    );
  };
}

export interface SessionTrust {
  read(): PiProjectTrust;
  write(trusted: boolean): PiProjectTrust;
}

// pi's project trust lives in the AGENT dir — our named volume — not in the project. That is what makes the
// decision survive a session without putting anything in the user's workspace.
//
// The decision also has to REACH pi's settings manager, which defaults `projectTrusted` to TRUE when nobody says
// otherwise: without this the project's own settings — packages above all — were writable into the user's workspace
// by a project they had never trusted. `onDecision` is called with the stored answer at construction and again on
// every write, so the two can never drift.
export function createSessionTrust(options: {
  agentDir: string;
  cwd: string;
  onDecision?: (trusted: boolean) => void;
}): SessionTrust {
  const store = new ProjectTrustStore(options.agentDir);
  const read = (): PiProjectTrust => ({
    decision: store.get(options.cwd),
    // A workspace with no `.pi` resources and no `.agents/skills` has nothing for the decision to gate. Saying so
    // is more use than a switch that changes nothing.
    matters: hasTrustRequiringProjectResources(options.cwd),
    path: options.cwd,
  });
  // An undecided project is not a trusted one: pi's own default would have been to trust it.
  options.onDecision?.(store.get(options.cwd) === true);
  return {
    read,
    write(trusted) {
      store.set(options.cwd, trusted);
      options.onDecision?.(trusted);
      return read();
    },
  };
}

export interface SessionSettings {
  read(): PiSessionSettings;
  write(patch: Partial<PiSessionSettings>): PiSessionSettings;
}

// pi keeps some of these on the session and some in the settings file. Which is which is not the user's problem,
// so they are read and written as one set.
export function createSessionSettings(session: () => AgentSession): SessionSettings {
  const read = (): PiSessionSettings => {
    const current = session();
    return {
      autoCompaction: current.autoCompactionEnabled,
      steeringMode: current.steeringMode,
      followUpMode: current.followUpMode,
      thinkingLevel: current.thinkingLevel,
      // Empty for a model that does not reason, which lets the app hide the control instead of offering a level
      // the provider will ignore.
      availableThinkingLevels: current.supportsThinking() ? [...current.getAvailableThinkingLevels()] : [],
    };
  };
  return {
    read,
    write(patch) {
      const current = session();
      if (patch.autoCompaction !== undefined) current.setAutoCompactionEnabled(patch.autoCompaction);
      if (patch.steeringMode) current.setSteeringMode(patch.steeringMode);
      if (patch.followUpMode) current.setFollowUpMode(patch.followUpMode);
      // Already checked against `availableThinkingLevels` by the caller, which is the only place that knows what
      // this model supports.
      if (patch.thinkingLevel) current.setThinkingLevel(patch.thinkingLevel as ThinkingLevel);
      return read();
    },
  };
}

export interface ScopedModels {
  read(): PiScopedModels;
  write(modelIds: string[]): PiScopedModels;
}

// The set pi cycles with Ctrl+P. Scoping nothing means it cycles everything available, which is pi's own default.
//
// Only the GATEWAY provider's models are listed: this session reaches exactly one upstream, so a model registered
// under any other provider is one it could never answer with. That set is the models this session has actually been
// pointed at — a provider's whole catalogue is never registered, so this list stays as short as the user's own use.
export function createScopedModels(deps: {
  session: () => AgentSession;
  services: () => AgentSessionServices;
  providerId: string;
}): ScopedModels {
  const available = () => deps.services().modelRuntime.getModels(deps.providerId);
  const read = (): PiScopedModels => ({
    available: available().map((model) => ({ id: model.id, name: model.name, provider: model.provider })),
    scoped: deps.session().scopedModels.map((scoped) => scoped.model.id),
  });
  return {
    read,
    write(modelIds) {
      const wanted = new Set(modelIds);
      deps.session().setScopedModels(
        available()
          .filter((model) => wanted.has(model.id))
          .map((model) => ({ model })),
      );
      return read();
    },
  };
}
