// The SKILLS a pi plugin contributes, as palette entries alongside the app's own.
//
// Only skills. A plugin's commands and prompt templates own their names and are pi's, not skill files — they are
// built in `piSessionCommands.ts` as `kind: "pi"`. Building them as skills here is what made the registry drop
// every one of them: a skill may only answer to `/skill:<name>`.
import type { ContributedResources } from "@/pi-bridge/protocol";

import type { AssistantCommandText, AssistantSkillCommandDefinition } from "./commandTypes";

const SURFACES = ["assistant", "quake-console"] as const;

// Anything pi would not parse back as one command word is not offered: a broken entry in the palette is worse
// than a missing one.
const COMMAND_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;

function literal(value: string): AssistantCommandText {
  return { kind: "literal", value };
}

export function pluginSkillCommands(resources: ContributedResources): AssistantSkillCommandDefinition[] {
  return resources.skills
    .filter((resource) => COMMAND_NAME.test(resource.name))
    .map((resource) => {
      const pluginId = resource.source ?? "local";
      // pi only invokes a skill explicitly, through `/skill:<name>`.
      const name = `skill:${resource.name}`;
      return {
        id: `plugin:skill:${pluginId}:${resource.name}`,
        kind: "skill" as const,
        skillId: name,
        path: `/${name}` as const,
        aliases: [],
        category: { kind: "i18n" as const, key: "Plugin skills" },
        // A plugin that documents nothing still shows where the skill came from, which is the more useful half.
        description: literal(resource.description ?? pluginId),
        hiddenSearchTerms: [resource.name, pluginId, "skill"],
        source: { kind: "plugin-skill" as const, pluginId, fingerprint: `${pluginId}:${resource.name}` },
        // The text goes to pi as a prompt, so it waits for an idle session like any other queued invocation.
        bypassTier: "queued" as const,
        availabilityId: "session-idle" as const,
        confirmation: "none" as const,
        arguments: { kind: "text" as const, required: false },
        surfaces: SURFACES,
      };
    });
}
