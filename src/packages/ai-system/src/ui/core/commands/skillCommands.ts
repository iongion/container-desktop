import type { SkillHostSnapshot, SkillSource, SkillViewDescriptor } from "@/ai-system/core/skills";

import { BUILTIN_ASSISTANT_COMMANDS } from "./commandCatalog";
import { createAssistantCommandRegistry } from "./commandRegistry";
import type { AssistantCommandDefinition, AssistantCommandText, AssistantSkillCommandDefinition } from "./commandTypes";

const SURFACES = ["assistant", "quake-console"] as const;

function literal(value: string): AssistantCommandText {
  return { kind: "literal", value };
}

function i18n(key: string): AssistantCommandText {
  return { kind: "i18n", key };
}

function commandSource(descriptor: SkillViewDescriptor): AssistantSkillCommandDefinition["source"] {
  const fingerprint = descriptor.fingerprint;
  switch (descriptor.source.kind) {
    case "bundled":
      return { kind: "bundled-skill", fingerprint };
    case "user":
      return { kind: "user-skill", fingerprint };
    case "project":
      return { kind: "project-skill", workspaceId: descriptor.source.workspaceId, fingerprint };
  }
}

function category(source: SkillSource): string {
  switch (source.kind) {
    case "bundled":
      return "Bundled skills";
    case "user":
      return "User skills";
    case "project":
      return "Project skills";
  }
}

function slashCommand(value: string): `/${string}` {
  return value as `/${string}`;
}

function skillCommand(descriptor: SkillViewDescriptor): AssistantSkillCommandDefinition {
  return {
    id: descriptor.id,
    kind: "skill",
    skillId: descriptor.id,
    path: slashCommand(descriptor.command),
    aliases: descriptor.shortCommand ? [slashCommand(descriptor.shortCommand)] : [],
    category: i18n(category(descriptor.source)),
    description: literal(descriptor.description),
    hiddenSearchTerms: [descriptor.name, descriptor.source.kind],
    ...(descriptor.argumentHint ? { argumentHint: literal(descriptor.argumentHint) } : {}),
    source: commandSource(descriptor),
    bypassTier: "queued",
    availabilityId: "session-idle",
    confirmation: "none",
    arguments: { kind: "text", required: false },
    surfaces: SURFACES,
  };
}

export function skillCommandsFromSnapshot(snapshot: SkillHostSnapshot): AssistantSkillCommandDefinition[] {
  return snapshot.skills.filter((skill) => skill.enabled && skill.trusted).map(skillCommand);
}

// What the running pi session contributes — its own commands, a plugin's commands and prompts, a plugin's skills —
// comes from the session rather than the host's skill store, so it is passed in instead of read here. The revision
// carries the count: a plugin installed or removed, or a session started or stopped, has to invalidate the registry
// or the palette keeps offering commands the session no longer has.
export function createSkillCommandRegistry(
  snapshot: SkillHostSnapshot,
  sessionCommands: readonly AssistantCommandDefinition[] = [],
) {
  return createAssistantCommandRegistry(`builtin-v3+skills:${snapshot.revision}+session:${sessionCommands.length}`, [
    BUILTIN_ASSISTANT_COMMANDS,
    skillCommandsFromSnapshot(snapshot),
    sessionCommands,
  ]);
}
