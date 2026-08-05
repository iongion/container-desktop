import { createAssistantCommandRegistry } from "./commandRegistry";
import type {
  AssistantCommandArgumentSpec,
  AssistantCommandAvailabilityId,
  AssistantCommandBypassTier,
  AssistantCommandText,
  AssistantControlCommandDefinition,
  BuiltinAssistantCommandId,
} from "./commandTypes";

const SURFACES = ["assistant", "quake-console"] as const;

const i18n = (key: string): AssistantCommandText => ({ kind: "i18n", key });

interface ControlInput {
  id: BuiltinAssistantCommandId;
  path: `/${string}`;
  aliases?: readonly `/${string}`[];
  categoryKey: string;
  descriptionKey: string;
  hiddenSearchTerms?: readonly string[];
  argumentHintKey?: string;
  bypassTier: AssistantCommandBypassTier;
  availabilityId: AssistantCommandAvailabilityId;
  confirmation?: "none" | "required";
  arguments: AssistantCommandArgumentSpec;
}

function control(input: ControlInput): AssistantControlCommandDefinition {
  return {
    id: input.id,
    kind: "control",
    handlerId: input.id,
    source: { kind: "builtin" },
    path: input.path,
    aliases: input.aliases ?? [],
    category: i18n(input.categoryKey),
    description: i18n(input.descriptionKey),
    hiddenSearchTerms: input.hiddenSearchTerms ?? [],
    argumentHint: input.argumentHintKey ? i18n(input.argumentHintKey) : undefined,
    bypassTier: input.bypassTier,
    availabilityId: input.availabilityId,
    confirmation: input.confirmation ?? "none",
    arguments: input.arguments,
    surfaces: SURFACES,
  };
}

export const BUILTIN_ASSISTANT_COMMANDS: readonly AssistantControlCommandDefinition[] = [
  control({
    id: "help",
    path: "/help",
    aliases: ["/h"],
    categoryKey: "Commands",
    descriptionKey: "Find an available command",
    hiddenSearchTerms: ["commands", "palette"],
    argumentHintKey: "[query]",
    bypassTier: "immediate-ui",
    availabilityId: "always",
    arguments: { kind: "text", required: false },
  }),
  control({
    id: "skills.open",
    path: "/skills",
    categoryKey: "Skills",
    descriptionKey: "Open the skill library",
    hiddenSearchTerms: ["extensions", "prompts", "project"],
    bypassTier: "immediate-ui",
    availabilityId: "always",
    arguments: { kind: "none" },
  }),
  control({
    id: "reload",
    path: "/reload",
    categoryKey: "Skills",
    // pi's own wording for it: this reloads the session's extensions, skills, prompts, themes and context files as
    // well as the app's skill library, which is why it is one command and not two.
    descriptionKey: "Reload keybindings, extensions, skills, prompts, themes, and context files",
    hiddenSearchTerms: ["refresh", "extensions", "diagnostics", "pi"],
    bypassTier: "side-effect-free",
    availabilityId: "always",
    arguments: { kind: "none" },
  }),
  control({
    id: "context.usage",
    path: "/tokens",
    categoryKey: "Context",
    descriptionKey: "Inspect context and token usage",
    hiddenSearchTerms: ["usage", "cost", "budget", "sources"],
    bypassTier: "immediate-ui",
    availabilityId: "session",
    arguments: { kind: "none" },
  }),
  control({
    id: "context.tools",
    path: "/tools",
    categoryKey: "Context",
    descriptionKey: "Inspect effective tools",
    hiddenSearchTerms: ["capabilities", "permissions", "available"],
    bypassTier: "immediate-ui",
    availabilityId: "session",
    arguments: { kind: "none" },
  }),
  control({
    id: "diagnostics.open",
    path: "/doctor",
    aliases: ["/status"],
    categoryKey: "Diagnostics",
    descriptionKey: "Check AI system health",
    hiddenSearchTerms: ["provider", "reachability", "health", "status"],
    bypassTier: "immediate-ui",
    availabilityId: "always",
    arguments: { kind: "none" },
  }),
  control({
    id: "changes.status",
    path: "/changes status",
    aliases: ["/changes"],
    categoryKey: "Workspace",
    descriptionKey: "Inspect workspace changes",
    hiddenSearchTerms: ["git", "status", "files", "target"],
    bypassTier: "immediate-ui",
    availabilityId: "always",
    arguments: { kind: "none" },
  }),
  control({
    id: "changes.diff",
    path: "/changes diff",
    aliases: ["/diff"],
    categoryKey: "Workspace",
    descriptionKey: "Review the full workspace diff",
    hiddenSearchTerms: ["git", "patch", "staged", "unstaged", "target"],
    bypassTier: "immediate-ui",
    availabilityId: "always",
    arguments: { kind: "none" },
  }),
  control({
    id: "memory.list",
    path: "/memory list",
    aliases: ["/memory"],
    categoryKey: "Project context",
    descriptionKey: "Open Project Memory",
    hiddenSearchTerms: ["context", "remember", "workspace"],
    bypassTier: "immediate-ui",
    availabilityId: "always",
    arguments: { kind: "none" },
  }),
  control({
    id: "memory.add",
    path: "/memory add",
    aliases: ["/remember"],
    categoryKey: "Project context",
    descriptionKey: "Prepare a Project Memory entry",
    hiddenSearchTerms: ["context", "remember", "workspace"],
    argumentHintKey: "<text>",
    bypassTier: "immediate-ui",
    availabilityId: "always",
    arguments: { kind: "text", required: true },
  }),
  control({
    id: "memory.remove",
    path: "/memory remove",
    categoryKey: "Project context",
    descriptionKey: "Find a Project Memory entry to remove",
    hiddenSearchTerms: ["context", "forget", "workspace"],
    argumentHintKey: "<id>",
    bypassTier: "immediate-ui",
    availabilityId: "always",
    arguments: { kind: "text", required: true },
  }),
  control({
    id: "memory.clear",
    path: "/memory clear",
    categoryKey: "Project context",
    descriptionKey: "Review Project Memory before clearing it",
    hiddenSearchTerms: ["context", "forget", "workspace"],
    bypassTier: "immediate-ui",
    availabilityId: "always",
    arguments: { kind: "none" },
  }),
  control({
    id: "rules.list",
    path: "/rules list",
    aliases: ["/rules"],
    categoryKey: "Project context",
    descriptionKey: "Open Project Rules",
    hiddenSearchTerms: ["context", "instructions", "workspace"],
    bypassTier: "immediate-ui",
    availabilityId: "always",
    arguments: { kind: "none" },
  }),
  control({
    id: "rules.init",
    path: "/rules init",
    aliases: ["/init"],
    categoryKey: "Project context",
    descriptionKey: "Prepare Project Rules initialization",
    hiddenSearchTerms: ["context", "instructions", "workspace", "create"],
    bypassTier: "immediate-ui",
    availabilityId: "always",
    arguments: { kind: "none" },
  }),
  control({
    id: "session.new",
    // pi's own name. A pi session IS the conversation, so this starts a fresh one — the app performs it, because
    // only the app can stop a container pair and start another.
    path: "/new",
    categoryKey: "Session",
    descriptionKey: "Start a new session",
    hiddenSearchTerms: ["clear", "reset", "session", "pi"],
    bypassTier: "queued",
    availabilityId: "idle",
    arguments: { kind: "none" },
  }),
  control({
    id: "session.quit",
    path: "/quit",
    categoryKey: "Session",
    descriptionKey: "Stop the session",
    hiddenSearchTerms: ["exit", "stop", "close", "pi"],
    bypassTier: "queued",
    availabilityId: "always",
    confirmation: "required",
    arguments: { kind: "none" },
  }),
  control({
    id: "session.info",
    path: "/session",
    categoryKey: "Session",
    descriptionKey: "Show session info and stats",
    hiddenSearchTerms: ["usage", "cost", "tokens", "stats", "pi"],
    bypassTier: "immediate-ui",
    availabilityId: "session",
    arguments: { kind: "none" },
  }),
  control({
    id: "turn.stop",
    // pi stops a turn with Escape and has no command for it; this name is the app's own and collides with nothing.
    path: "/stop",
    categoryKey: "Session",
    descriptionKey: "Stop the active turn",
    hiddenSearchTerms: ["cancel", "interrupt", "abort"],
    bypassTier: "always",
    availabilityId: "session-active",
    arguments: { kind: "none" },
  }),
  control({
    id: "session.copy",
    path: "/copy",
    categoryKey: "Session",
    descriptionKey: "Copy last agent message to clipboard",
    hiddenSearchTerms: ["clipboard", "response"],
    bypassTier: "side-effect-free",
    availabilityId: "session",
    arguments: { kind: "none" },
  }),
  control({
    id: "session.export",
    path: "/export",
    categoryKey: "Session",
    descriptionKey: "Export session (HTML default, or specify path: .html/.jsonl)",
    hiddenSearchTerms: ["save", "json", "download"],
    bypassTier: "immediate-ui",
    availabilityId: "session",
    arguments: { kind: "none" },
  }),
  control({
    id: "session.import",
    // pi's own name. The app owns the half that needs a host file dialog; the session performs pi's import.
    path: "/import",
    categoryKey: "Session",
    descriptionKey: "Import and resume a session from a JSONL file",
    hiddenSearchTerms: ["jsonl", "open", "restore", "pi"],
    bypassTier: "queued",
    availabilityId: "session-idle",
    arguments: { kind: "none" },
  }),
  control({
    id: "session.share",
    // pi's own name and purpose — the conversation as HTML. pi's gist was its TRANSPORT, and this app has none, so
    // the file is saved where the user chooses.
    path: "/share",
    categoryKey: "Session",
    descriptionKey: "Share the session as one standalone HTML file",
    hiddenSearchTerms: ["html", "export", "save", "gist", "pi"],
    bypassTier: "immediate-ui",
    availabilityId: "session",
    arguments: { kind: "none" },
  }),
  control({
    id: "provider.login",
    path: "/login",
    categoryKey: "Model",
    descriptionKey: "Configure provider authentication",
    hiddenSearchTerms: ["key", "api", "credential", "auth", "pi"],
    bypassTier: "immediate-ui",
    availabilityId: "always",
    arguments: { kind: "text", required: false },
  }),
  control({
    id: "provider.logout",
    path: "/logout",
    categoryKey: "Model",
    descriptionKey: "Remove provider authentication",
    hiddenSearchTerms: ["key", "api", "credential", "forget", "pi"],
    bypassTier: "immediate-ui",
    availabilityId: "always",
    // Removing a key is not undoable from here — the user re-enters it.
    confirmation: "required",
    arguments: { kind: "text", required: false },
  }),
  control({
    id: "model.open",
    path: "/model",
    categoryKey: "Model",
    descriptionKey: "Select model (opens selector UI)",
    // pi's own argument, and pi's own meaning: named, it switches straight away; bare, it opens the selector. The
    // session is re-pointed in place either way, so this is no longer a choice that costs the conversation.
    argumentHintKey: "<provider/model>",
    bypassTier: "immediate-ui",
    availabilityId: "session-idle-only",
    arguments: { kind: "text", required: false },
  }),
  control({
    id: "permissions.open",
    path: "/permissions",
    categoryKey: "Permissions",
    descriptionKey: "Open AI permissions settings",
    hiddenSearchTerms: ["access", "safety", "approval"],
    bypassTier: "immediate-ui",
    availabilityId: "always",
    arguments: { kind: "none" },
  }),
];

export const BUILTIN_ASSISTANT_COMMAND_REGISTRY = createAssistantCommandRegistry("builtin-v12", [
  BUILTIN_ASSISTANT_COMMANDS,
]);
