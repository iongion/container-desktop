// pi's own slash commands, offered under pi's own names.
//
// pi implements these in its interactive TUI, not in the SDK the container runs, and it does not export the
// catalogue — so the names, descriptions and argument hints are MIRRORED from `core/slash-commands.ts` in the
// installed package. Keep them identical: the whole point is that a user who knows pi types what they know, and a
// renamed or invented variant would be a different product wearing pi's vocabulary.
//
// Each command declares where it runs. `session` is performed here, against the SDK — including the ones that
// REPLACE the session, because `AgentSessionRuntime` does that in process. `app` belongs to the GUI: stopping the
// container pair, choosing the model, writing a file to the host. `unavailable` carries the architectural reason,
// offered and explained rather than hidden.

import type { AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";

import { projectSessionTree } from "@/pi-agent-host/sessionTree";
import type { PiBuiltinCommand, PiCommandResult } from "@/pi-bridge/protocol";

export type PiCommandName =
  | "settings"
  | "model"
  | "scoped-models"
  | "export"
  | "import"
  | "share"
  | "copy"
  | "name"
  | "session"
  | "changelog"
  | "hotkeys"
  | "fork"
  | "clone"
  | "tree"
  | "trust"
  | "login"
  | "logout"
  | "new"
  | "compact"
  | "resume"
  | "reload"
  | "quit";

interface Builtin extends PiBuiltinCommand {
  name: PiCommandName;
}

// pi's catalogue, in pi's order, with pi's wording. `runsIn` and `reason` are this app's.
export const PI_BUILTIN_COMMANDS: readonly Builtin[] = [
  {
    name: "settings",
    description: "Open settings menu",
    runsIn: "unavailable",
    reason: "pi's settings live in the agent container; this app manages the session and its plugins instead",
  },
  { name: "model", description: "Select model (opens selector UI)", argumentHint: "<provider/model>", runsIn: "app" },
  {
    name: "scoped-models",
    description: "Enable/disable models for Ctrl+P cycling",
    runsIn: "unavailable",
    reason: "a session runs against exactly one model, chosen when it starts, so there is nothing to scope",
  },
  {
    name: "export",
    description: "Export session (HTML default, or specify path: .html/.jsonl)",
    runsIn: "app",
  },
  {
    name: "import",
    description: "Import and resume a session from a JSONL file",
    runsIn: "unavailable",
    reason: "the file would have to be inside the agent container, which only the session's workspace reaches",
  },
  {
    name: "share",
    description: "Share session as a secret GitHub gist",
    runsIn: "unavailable",
    reason: "this app holds no GitHub credential, and a session may be started with no network at all",
  },
  { name: "copy", description: "Copy last agent message to clipboard", runsIn: "app" },
  { name: "name", description: "Set session display name", runsIn: "session" },
  { name: "session", description: "Show session info and stats", runsIn: "app" },
  { name: "changelog", description: "Show changelog entries", runsIn: "session" },
  { name: "hotkeys", description: "Show all keyboard shortcuts", runsIn: "session" },
  { name: "fork", description: "Create a new fork from a previous user message", runsIn: "session" },
  {
    name: "clone",
    description: "Duplicate the current session at the current position",
    runsIn: "unavailable",
    reason: "the copy could not be opened: this container runs the one session it was started with",
  },
  { name: "tree", description: "Navigate session tree (switch branches)", runsIn: "session" },
  {
    name: "trust",
    description: "Save project trust decision for future sessions",
    runsIn: "unavailable",
    reason: "the project is deliberately never trusted here, so pi writes nothing into your workspace",
  },
  {
    name: "login",
    description: "Configure provider authentication",
    argumentHint: "<provider>",
    runsIn: "unavailable",
    reason: "the provider key stays in a separate gateway container; the agent never holds a credential",
  },
  {
    name: "logout",
    description: "Remove provider authentication",
    runsIn: "unavailable",
    reason: "the provider key stays in a separate gateway container; the agent never holds a credential",
  },
  { name: "new", description: "Start a new session", runsIn: "session" },
  { name: "compact", description: "Manually compact the session context", runsIn: "session" },
  {
    name: "resume",
    description: "Resume a different session",
    runsIn: "unavailable",
    reason: "this container runs the one session it was started with; start another to resume a different one",
  },
  {
    name: "reload",
    description: "Reload keybindings, extensions, skills, prompts, themes, and context files",
    runsIn: "session",
  },
  { name: "quit", description: "Quit pi", runsIn: "app" },
];

const BY_NAME = new Map<string, Builtin>(PI_BUILTIN_COMMANDS.map((command) => [command.name, command]));

export function isPiCommandName(value: string): value is PiCommandName {
  return BY_NAME.has(value);
}

// What a session-side command needs. Narrow structural types rather than pi's classes, so the dispatcher is
// testable without a live session.
export interface PiCommandDeps {
  session: Pick<
    AgentSession,
    "compact" | "setSessionName" | "getUserMessagesForForking" | "navigateTree" | "reload" | "getSessionStats"
  >;
  // `getLeafId` is what tells the tree which branch is live: pi answers with a leaf id alone, and a picker that
  // cannot say "you are here" is a list of ids.
  sessionManager: Pick<SessionManager, "getTree" | "getSessionName" | "getLeafId">;
  // pi's session replacements, which its own runtime performs without restarting anything. The host wraps each one
  // so the app is told why its transcript was reset and is handed the new session's history.
  runtime: {
    newSession(): Promise<{ cancelled: boolean }>;
  };
  // The keys pi's own components respond to inside a focused surface. The GUI has its own bindings everywhere else,
  // which is why this answers with the set that is actually in effect for pi, not a fabricated GUI cheat sheet.
  keybindings: () => Array<{ action: string; keys: string[] }>;
  // pi's shipped changelog, read from the installed package by the caller — a document, not composed prose.
  changelog: () => Promise<string>;
}

function refusal(name: PiCommandName): PiCommandResult {
  const command = BY_NAME.get(name);
  return { ok: false, error: command?.reason ?? `/${name} is not available in this session` };
}

export async function runPiCommand(deps: PiCommandDeps, name: string, args: string): Promise<PiCommandResult> {
  if (!isPiCommandName(name)) return { ok: false, error: `unknown pi command: /${name}` };
  const command = BY_NAME.get(name) as Builtin;
  if (command.runsIn === "unavailable") return refusal(name);
  // An app-side command reaching the container means the GUI forgot to handle it — say so rather than doing nothing.
  if (command.runsIn === "app") return { ok: false, error: `/${name} is performed by the app, not the session` };

  switch (name) {
    case "compact": {
      const result = await deps.session.compact(args.trim() || undefined);
      return { ok: true, data: { summary: result.summary, tokensBefore: result.tokensBefore } };
    }
    case "name": {
      const label = args.trim();
      if (!label) return { ok: false, error: "give the session a name: /name <text>" };
      deps.session.setSessionName(label);
      return { ok: true, data: { name: label } };
    }
    case "changelog":
      return { ok: true, data: { markdown: await deps.changelog() } };
    case "hotkeys":
      return { ok: true, data: { bindings: deps.keybindings() } };
    case "fork": {
      const points = deps.session.getUserMessagesForForking();
      const target = args.trim();
      // With no argument this is a question, not an action: the app shows the points and the user names one.
      if (!target) return { ok: true, data: { forkPoints: points } };
      const chosen = points.find((point) => point.entryId === target);
      if (!chosen) return { ok: false, error: `no fork point with id ${target}` };
      const result = await deps.session.navigateTree(chosen.entryId);
      return result.cancelled
        ? { ok: false, error: "the fork was cancelled" }
        : { ok: true, data: { forkedFrom: chosen.entryId, editorText: result.editorText } };
    }
    case "tree": {
      const target = args.trim();
      // Projected, never raw: pi's own tree carries whole message bodies and an entry union the app cannot render.
      if (!target) {
        return {
          ok: true,
          data: { tree: projectSessionTree(deps.sessionManager.getTree(), deps.sessionManager.getLeafId()) },
        };
      }
      const result = await deps.session.navigateTree(target);
      return result.cancelled
        ? { ok: false, error: "the branch switch was cancelled" }
        : { ok: true, data: { movedTo: target, editorText: result.editorText } };
    }
    // A fresh conversation on the same containers, the same plugins and the same workspace — pi swaps the session
    // behind the runtime. Cancellable, because an extension may hold a `session_before_switch` handler.
    case "new": {
      const { cancelled } = await deps.runtime.newSession();
      return cancelled ? { ok: false, error: "an extension cancelled the new session" } : { ok: true };
    }
    case "reload":
      await deps.session.reload();
      return { ok: true, data: { reloaded: true } };
    default:
      return refusal(name);
  }
}
