export type BuiltinAssistantCommandId =
  | "help"
  | "skills.open"
  | "reload"
  | "context.usage"
  | "context.tools"
  | "diagnostics.open"
  | "changes.status"
  | "changes.diff"
  | "memory.list"
  | "memory.add"
  | "memory.remove"
  | "memory.clear"
  | "rules.list"
  | "rules.init"
  | "session.new"
  | "session.quit"
  | "session.info"
  | "session.copy"
  | "session.export"
  | "session.import"
  | "session.share"
  | "provider.login"
  | "provider.logout"
  | "turn.stop"
  | "model.open"
  | "permissions.open";

export type AssistantCommandId = string;

export type AssistantCommandSource =
  | { kind: "builtin" }
  | { kind: "bundled-skill"; fingerprint: string }
  | { kind: "user-skill"; fingerprint: string }
  | { kind: "project-skill"; workspaceId: string; fingerprint: string }
  | { kind: "plugin-skill"; pluginId: string; fingerprint: string }
  // A command the pi SESSION owns: one of pi's own built-ins, or one a loaded plugin registered with it.
  | { kind: "pi-builtin" }
  | { kind: "pi-plugin"; pluginId: string };

export type AssistantCommandText = { kind: "i18n"; key: string } | { kind: "literal"; value: string };

export type AssistantCommandBypassTier = "always" | "connecting" | "immediate-ui" | "side-effect-free" | "queued";

export type AssistantCommandAvailabilityId =
  | "always"
  | "idle"
  | "session"
  | "session-idle"
  | "session-idle-only"
  | "session-active"
  | "assistant-only"
  | "quake-console-only";

export type AssistantCommandSurface = "assistant" | "quake-console";

export type AssistantCommandArgumentSpec =
  | { kind: "none" }
  | { kind: "text"; required: boolean }
  | { kind: "tokens"; min: number; max: number };

interface AssistantCommandBase {
  id: AssistantCommandId;
  path: `/${string}`;
  aliases: readonly `/${string}`[];
  category: AssistantCommandText;
  description: AssistantCommandText;
  hiddenSearchTerms: readonly string[];
  argumentHint?: AssistantCommandText;
  source: AssistantCommandSource;
  bypassTier: AssistantCommandBypassTier;
  availabilityId: AssistantCommandAvailabilityId;
  confirmation: "none" | "required";
  arguments: AssistantCommandArgumentSpec;
  surfaces: readonly AssistantCommandSurface[];
}

export interface AssistantControlCommandDefinition extends AssistantCommandBase {
  kind: "control";
  id: BuiltinAssistantCommandId;
  handlerId: BuiltinAssistantCommandId;
  source: { kind: "builtin" };
}

export interface AssistantSkillCommandDefinition extends AssistantCommandBase {
  kind: "skill";
  skillId: string;
  source: Extract<
    AssistantCommandSource,
    { kind: "bundled-skill" } | { kind: "user-skill" } | { kind: "project-skill" } | { kind: "plugin-skill" }
  >;
}

// Where a pi command is carried out. `session` crosses the bridge and runs against pi's own session; `prompt` is
// text pi expands itself when it arrives (how a plugin's command and a prompt template work); `app` is one the GUI
// performs, and is declared in the app's own catalogue instead; `unavailable` is offered with a reason and refused
// before it runs.
export type AssistantPiCommandVenue = "session" | "prompt" | "app" | "unavailable";

// A command the pi session owns, under pi's own name. NOT a skill: a skill is a file the user or a package supplies
// and pi only ever invokes as `/skill:<name>`, whereas these own their names the way a built-in does.
export interface AssistantPiCommandDefinition extends AssistantCommandBase {
  kind: "pi";
  // pi's name for it, without the slash — exactly what travels over the bridge.
  commandName: string;
  venue: AssistantPiCommandVenue;
  // Why this architecture cannot honour it. Present only for `unavailable`.
  unavailableReason?: string;
  source: Extract<AssistantCommandSource, { kind: "pi-builtin" } | { kind: "pi-plugin" }>;
}

export type AssistantCommandDefinition =
  | AssistantControlCommandDefinition
  | AssistantSkillCommandDefinition
  | AssistantPiCommandDefinition;

export interface AssistantCommandConflict {
  commandId: AssistantCommandId;
  name: string;
  ownerId: AssistantCommandId;
  reason: "reserved" | "duplicate" | "duplicate-id" | "malformed";
}

export interface AssistantCommandLookupEntry {
  name: string;
  command: AssistantCommandDefinition;
  pathLength: number;
}

export interface AssistantCommandRegistry {
  revision: string;
  commands: readonly AssistantCommandDefinition[];
  conflicts: readonly AssistantCommandConflict[];
  reservedNames: readonly string[];
  byName: Readonly<Record<string, AssistantCommandDefinition | undefined>>;
  lookup: readonly AssistantCommandLookupEntry[];
  byBypassTier: Readonly<Record<AssistantCommandBypassTier, readonly AssistantCommandDefinition[]>>;
}

export type AssistantCommandErrorCode =
  | "too-long"
  | "too-many-arguments"
  | "unterminated-quote"
  | "unknown-command"
  | "missing-argument";

export type AssistantInputParseResult =
  | { kind: "message"; text: string }
  | {
      kind: "command";
      id: AssistantCommandId;
      command: AssistantCommandDefinition;
      args: string[];
      rawArguments: string;
    }
  | {
      kind: "error";
      code: AssistantCommandErrorCode;
      messageKey: string;
      suggestions: AssistantCommandId[];
    };

export interface AssistantCommandMatch {
  command: AssistantCommandDefinition;
  matchedBy: string;
}

export type AssistantCommandUIEffect = { kind: "open-command-palette"; query: string } | { kind: "open-model-picker" };

export type AssistantCommandExecutionResult = AssistantCommandUIEffect | undefined;
