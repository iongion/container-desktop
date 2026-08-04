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
import type {
  PiBuiltinCommand,
  PiCommandResult,
  PiProjectTrust,
  PiScopedModels,
  PiSessionSettings,
  PiSessionSummary,
} from "@/pi-bridge/protocol";

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
  { name: "settings", description: "Open settings menu", runsIn: "session" },
  { name: "model", description: "Select model (opens selector UI)", argumentHint: "<provider/model>", runsIn: "app" },
  { name: "scoped-models", description: "Enable/disable models for Ctrl+P cycling", runsIn: "session" },
  {
    name: "export",
    description: "Export session (HTML default, or specify path: .html/.jsonl)",
    runsIn: "app",
  },
  // The app owns the half that needs a host file dialog and the host filesystem; it hands the contents to the
  // session over the bridge, which then performs pi's own import.
  { name: "import", description: "Import and resume a session from a JSONL file", runsIn: "app" },
  // pi's own name and pi's own purpose — sharing the conversation as HTML. The gist was pi's TRANSPORT, and this
  // app has none: the file is saved where the user chooses. No upload, no GitHub credential.
  { name: "share", description: "Share session as a secret GitHub gist", runsIn: "app" },
  { name: "copy", description: "Copy last agent message to clipboard", runsIn: "app" },
  { name: "name", description: "Set session display name", runsIn: "session" },
  { name: "session", description: "Show session info and stats", runsIn: "app" },
  { name: "changelog", description: "Show changelog entries", runsIn: "session" },
  { name: "hotkeys", description: "Show all keyboard shortcuts", runsIn: "session" },
  { name: "fork", description: "Create a new fork from a previous user message", runsIn: "session" },
  { name: "clone", description: "Duplicate the current session at the current position", runsIn: "session" },
  { name: "tree", description: "Navigate session tree (switch branches)", runsIn: "session" },
  { name: "trust", description: "Save project trust decision for future sessions", runsIn: "session" },
  // Provider auth is the APP's: it owns the settings, the keychain and the gateway's env file. The agent never
  // holds a credential, which is why the agent is not where you configure one.
  { name: "login", description: "Configure provider authentication", argumentHint: "<provider>", runsIn: "app" },
  { name: "logout", description: "Remove provider authentication", runsIn: "app" },
  { name: "new", description: "Start a new session", runsIn: "session" },
  { name: "compact", description: "Manually compact the session context", runsIn: "session" },
  { name: "resume", description: "Resume a different session", runsIn: "session" },
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
    // `/clone` — pi's fork AT a chosen entry rather than before it, which is what makes it a duplicate of the
    // conversation as it stands instead of a rewind.
    clone(entryId: string): Promise<{ cancelled: boolean }>;
    switchSession(path: string): Promise<{ cancelled: boolean }>;
  };
  // The sessions this workspace has on disk, newest first. Async because pi reads and parses every file to build it.
  listSessions: () => Promise<PiSessionSummary[]>;
  // pi's project-trust decision, stored in the AGENT dir. Writing one puts nothing in the user's workspace.
  trust: {
    read(): PiProjectTrust;
    write(trusted: boolean): PiProjectTrust;
  };
  // The runtime session settings, read and written as one set: pi keeps some on the session and some in the
  // settings file, and which is which is not the user's problem.
  settings: {
    read(): PiSessionSettings;
    write(patch: Partial<PiSessionSettings>): PiSessionSettings;
  };
  // Every model this session could cycle to, and the subset `/scoped-models` narrowed it to.
  models: {
    read(): PiScopedModels;
    write(modelIds: string[]): PiScopedModels;
  };
  // The keys pi's own components respond to inside a focused surface. The GUI has its own bindings everywhere else,
  // which is why this answers with the set that is actually in effect for pi, not a fabricated GUI cheat sheet.
  keybindings: () => Array<{ action: string; keys: string[] }>;
  // pi's shipped changelog, read from the installed package by the caller — a document, not composed prose.
  changelog: () => Promise<string>;
}

// `/settings` with no argument reports; with one it writes. The typed line is pi's own `key value` shape rather than
// JSON, because a user types this — and an unknown key is refused rather than silently ignored, which would read as
// a setting that would not stick.
type SettingsArgument = { value?: Partial<PiSessionSettings> } | { error: string };

const BOOLEAN_WORDS: Record<string, boolean> = { on: true, off: false, true: true, false: false };
const QUEUE_MODES = ["all", "one-at-a-time"];

function parseSettingsArgument(args: string): SettingsArgument {
  const [key, ...rest] = args.trim().split(/\s+/).filter(Boolean);
  if (!key) return {};
  const value = rest.join(" ");
  if (!value) return { error: `say /settings ${key} <value>` };
  switch (key) {
    case "autoCompaction": {
      const enabled = BOOLEAN_WORDS[value.toLowerCase()];
      if (enabled === undefined) return { error: "autoCompaction is on or off" };
      return { value: { autoCompaction: enabled } };
    }
    case "steeringMode":
    case "followUpMode":
      if (!QUEUE_MODES.includes(value)) return { error: `${key} is ${QUEUE_MODES.join(" or ")}` };
      return { value: { [key]: value as "all" | "one-at-a-time" } };
    case "thinkingLevel":
      return { value: { thinkingLevel: value } };
    default:
      return { error: `this session has no setting called ${key}` };
  }
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
    // A duplicate of the conversation as it stands, so the user can take it somewhere else and keep this one. pi
    // forks AT the current leaf; with no leaf there is nothing yet to duplicate.
    case "clone": {
      const leafId = deps.sessionManager.getLeafId();
      if (!leafId) return { ok: false, error: "there is nothing to clone yet — say something first" };
      const { cancelled } = await deps.runtime.clone(leafId);
      return cancelled ? { ok: false, error: "an extension cancelled the clone" } : { ok: true };
    }
    // With no argument this is a question: the app lists what there is to resume and the user picks one. pi refuses
    // to open a path it cannot see, and its own message says which — so this passes the path through rather than
    // validating it against the list a moment earlier.
    case "resume": {
      const target = args.trim();
      if (!target) return { ok: true, data: { sessions: await deps.listSessions() } };
      const { cancelled } = await deps.runtime.switchSession(target);
      return cancelled ? { ok: false, error: "an extension cancelled the resume" } : { ok: true };
    }
    // Trust is a decision, so a bare `/trust` reports the one in force rather than silently changing it. pi's own
    // words for the argument: `on` and `off`.
    case "trust": {
      const target = args.trim().toLowerCase();
      if (!target) return { ok: true, data: { trust: deps.trust.read() } };
      if (target !== "on" && target !== "off") {
        return { ok: false, error: "say /trust on or /trust off" };
      }
      return { ok: true, data: { trust: deps.trust.write(target === "on") } };
    }
    case "settings": {
      const patch = parseSettingsArgument(args);
      if ("error" in patch) return { ok: false, error: patch.error };
      if (!patch.value) return { ok: true, data: { settings: deps.settings.read() } };
      const level = patch.value.thinkingLevel;
      // What a model can reason at is the model's, not pi's. Writing a level it cannot reach would show the change
      // in the drawer and be silently clamped on the next turn.
      if (level !== undefined) {
        const available = deps.settings.read().availableThinkingLevels;
        if (!available.includes(level)) {
          return {
            ok: false,
            error: available.length
              ? `thinkingLevel is ${available.join(", ")}`
              : "this model does not reason, so it has no thinking level",
          };
        }
      }
      return { ok: true, data: { settings: deps.settings.write(patch.value) } };
    }
    // pi cycles through the scoped set with Ctrl+P, or through everything available when nothing is scoped. A bare
    // command reports both halves so the app can offer the choice; ids narrow it, and `all` widens it again.
    case "scoped-models": {
      const target = args.trim();
      if (!target) return { ok: true, data: { models: deps.models.read() } };
      const ids = target.toLowerCase() === "all" ? [] : target.split(/[\s,]+/).filter(Boolean);
      const available = new Set(deps.models.read().available.map((model) => model.id));
      const unknown = ids.filter((id) => !available.has(id));
      if (unknown.length) return { ok: false, error: `this session has no model ${unknown.join(", ")}` };
      return { ok: true, data: { models: deps.models.write(ids) } };
    }
    case "reload":
      await deps.session.reload();
      return { ok: true, data: { reloaded: true } };
    default:
      return refusal(name);
  }
}
