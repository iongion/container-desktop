// The slash commands a pi plugin contributes: extension commands, skills and prompt templates, as palette
// entries alongside the built-ins and the app's own skills.
//
// They are `kind: "skill"` with a `plugin-skill` source, which is what tells the executor to send the text to
// pi instead of resolving it against the app's skill host. pi expands its own skills and templates when the
// prompt arrives, so nothing is expanded here.
import type { ContributedResource, ContributedResources } from "@/pi-bridge/protocol";

import type { AssistantCommandText, AssistantSkillCommandDefinition } from "./commandTypes";

const SURFACES = ["assistant", "quake-console"] as const;

// Anything pi would not parse back as one command word is not offered: a broken entry in the palette is worse
// than a missing one.
const COMMAND_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;

function literal(value: string): AssistantCommandText {
  return { kind: "literal", value };
}

interface PluginCommandGroup {
  resources: ContributedResource[];
  category: string;
  prefix: string;
  kind: string;
}

function definition(resource: ContributedResource, group: PluginCommandGroup): AssistantSkillCommandDefinition {
  const pluginId = resource.source ?? "local";
  const name = `${group.prefix}${resource.name}`;
  return {
    id: `plugin:${group.kind}:${pluginId}:${resource.name}`,
    kind: "skill",
    skillId: name,
    path: `/${name}`,
    aliases: [],
    category: { kind: "i18n", key: group.category },
    // A plugin that documents nothing still shows where the command came from, which is the more useful half.
    description: literal(resource.description ?? pluginId),
    hiddenSearchTerms: [resource.name, pluginId, group.kind],
    source: { kind: "plugin-skill", pluginId, fingerprint: `${pluginId}:${resource.name}` },
    // The text goes to pi as a prompt, so it waits for an idle thread like any other queued invocation.
    bypassTier: "queued",
    availabilityId: "thread-idle",
    confirmation: "none",
    arguments: { kind: "text", required: false },
    surfaces: SURFACES,
  };
}

export function pluginCommandsFromResources(resources: ContributedResources): AssistantSkillCommandDefinition[] {
  const groups: PluginCommandGroup[] = [
    { resources: resources.commands, category: "Plugin commands", prefix: "", kind: "command" },
    // pi only invokes a skill explicitly through `/skill:<name>`.
    { resources: resources.skills, category: "Plugin skills", prefix: "skill:", kind: "skill" },
    { resources: resources.prompts, category: "Plugin prompts", prefix: "", kind: "prompt" },
  ];
  return groups.flatMap((group) =>
    group.resources
      .filter((resource) => COMMAND_NAME.test(resource.name))
      .map((resource) => definition(resource, group)),
  );
}
