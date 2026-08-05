// pi's own slash commands, as palette entries under pi's own names.
//
// The list comes from the session, not from a table in the app: whatever this pi has, the palette shows. A command
// the GUI performs itself (`app`) is declared in the app's own catalogue instead — it is offered under exactly the
// same name, so nothing here would add but a duplicate the registry would have to drop.
//
// Nothing is renamed, prefixed or merged with an app command of similar purpose. A user who knows pi types what
// they know; a command this architecture cannot honour is still listed, with the reason.

import type { ContributedResource, ContributedResources, PiBuiltinCommand } from "@/pi-bridge/protocol";

import type { AssistantCommandText, AssistantPiCommandDefinition, AssistantPiCommandVenue } from "./commandTypes";

const SURFACES = ["assistant", "quake-console"] as const;

// Anything pi would not parse back as one command word is not offered: a broken palette entry is worse than a
// missing one.
const COMMAND_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;

function literal(value: string): AssistantCommandText {
  return { kind: "literal", value };
}

// A session command changes the conversation pi is holding, so it waits for an idle turn like any other submission.
// An unavailable one is refused before it runs, and must therefore stay reachable in every phase to be explained.
function availability(venue: AssistantPiCommandVenue) {
  return venue === "unavailable"
    ? ({ availabilityId: "always", bypassTier: "immediate-ui" } as const)
    : ({ availabilityId: "session-idle", bypassTier: "queued" } as const);
}

export function piBuiltinCommandDefinitions(
  builtins: readonly PiBuiltinCommand[],
  // The names the app's own catalogue already offers. pi reports them because pi has them; the app performs them.
  appOwnedNames: readonly string[] = [],
): AssistantPiCommandDefinition[] {
  const appOwned = new Set(appOwnedNames);
  return builtins
    .filter((builtin) => COMMAND_NAME.test(builtin.name) && builtin.runsIn !== "app" && !appOwned.has(builtin.name))
    .map((builtin) => ({
      id: `pi:builtin:${builtin.name}`,
      kind: "pi" as const,
      commandName: builtin.name,
      venue: builtin.runsIn as AssistantPiCommandVenue,
      ...(builtin.runsIn === "unavailable" && builtin.reason ? { unavailableReason: builtin.reason } : {}),
      path: `/${builtin.name}` as const,
      aliases: [],
      category: { kind: "i18n" as const, key: "pi commands" },
      // pi's own wording, verbatim: the description a pi user already recognises.
      description: literal(builtin.description),
      hiddenSearchTerms: ["pi", builtin.name],
      ...(builtin.argumentHint ? { argumentHint: literal(builtin.argumentHint) } : {}),
      source: { kind: "pi-builtin" as const },
      ...availability(builtin.runsIn as AssistantPiCommandVenue),
      confirmation: "none" as const,
      arguments: { kind: "text" as const, required: false },
      surfaces: SURFACES,
    }));
}

interface ContributedGroup {
  resources: readonly ContributedResource[];
  categoryKey: string;
  kind: string;
}

// What a loaded plugin contributes to pi: its own commands and prompt templates. pi expands both when the text
// arrives as a prompt, which is why they are `prompt`-venue rather than a bridge call — and why they are NOT skills:
// they own their names, and the registry must not treat them as a file trying to claim one.
export function piPluginCommandDefinitions(resources: ContributedResources): AssistantPiCommandDefinition[] {
  const groups: ContributedGroup[] = [
    { resources: resources.commands, categoryKey: "Plugin commands", kind: "command" },
    { resources: resources.prompts, categoryKey: "Plugin prompts", kind: "prompt" },
  ];
  return groups.flatMap((group) =>
    group.resources
      .filter((resource) => COMMAND_NAME.test(resource.name))
      .map((resource) => {
        const pluginId = resource.source ?? "local";
        return {
          id: `pi:${group.kind}:${pluginId}:${resource.name}`,
          kind: "pi" as const,
          commandName: resource.name,
          venue: "prompt" as const,
          path: `/${resource.name}` as const,
          aliases: [],
          category: { kind: "i18n" as const, key: group.categoryKey },
          // A plugin that documents nothing still shows where the command came from, which is the more useful half.
          description: literal(resource.description ?? pluginId),
          hiddenSearchTerms: [resource.name, pluginId, group.kind],
          source: { kind: "pi-plugin" as const, pluginId },
          availabilityId: "session-idle" as const,
          bypassTier: "queued" as const,
          confirmation: "none" as const,
          arguments: { kind: "text" as const, required: false },
          surfaces: SURFACES,
        };
      }),
  );
}
