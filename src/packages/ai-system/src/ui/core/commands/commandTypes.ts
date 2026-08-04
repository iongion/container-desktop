import type { AccessProfileId } from "@/ai-system/core/accessProfiles";
import type { ReasoningLevel } from "@/ai-system/core/reasoning";

export type BuiltinAssistantCommandId =
  | "help"
  | "skills.open"
  | "skills.reload"
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
  | "thread.list"
  | "thread.new"
  | "thread.switch"
  | "thread.rename"
  | "thread.branch"
  | "thread.compact"
  | "thread.delete"
  | "thread.stop"
  | "thread.copy"
  | "thread.export"
  | "model.open"
  | "access.set"
  | "reasoning.set"
  | "permissions.open";

export type AssistantCommandId = string;

export type AssistantCommandSource =
  | { kind: "builtin" }
  | { kind: "bundled-skill"; fingerprint: string }
  | { kind: "user-skill"; fingerprint: string }
  | { kind: "project-skill"; workspaceId: string; fingerprint: string }
  | { kind: "plugin-skill"; pluginId: string; fingerprint: string };

export type AssistantCommandText = { kind: "i18n"; key: string } | { kind: "literal"; value: string };

export type AssistantCommandBypassTier = "always" | "connecting" | "immediate-ui" | "side-effect-free" | "queued";

export type AssistantCommandAvailabilityId =
  | "always"
  | "idle"
  | "thread"
  | "thread-idle"
  | "thread-idle-only"
  | "thread-active"
  | "assistant-only"
  | "quake-console-only";

// What a SESSION can do, as opposed to what the surface or the current phase allows. A pi session is one
// conversation that takes its model and access at start, so it carries none of these — and a command needing
// one must be refused with a reason BEFORE it runs, not accepted and then rejected from inside the store.
export type AssistantCommandCapabilityId = "conversation-reset" | "threads" | "history" | "configuration";

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
  // Absent ⇒ every session can run it.
  capabilityId?: AssistantCommandCapabilityId;
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
  source: Exclude<AssistantCommandSource, { kind: "builtin" }>;
}

export type AssistantCommandDefinition = AssistantControlCommandDefinition | AssistantSkillCommandDefinition;

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

export type AssistantCommandUIEffect =
  | { kind: "open-command-palette"; query: string }
  | { kind: "open-model-picker" }
  | { kind: "open-access-profile" }
  | { kind: "set-access-profile"; value: AccessProfileId }
  | { kind: "open-reasoning-level" }
  | { kind: "set-reasoning-level"; value: ReasoningLevel };

export type AssistantCommandExecutionResult = AssistantCommandUIEffect | undefined;
