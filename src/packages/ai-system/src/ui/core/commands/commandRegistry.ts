import type {
  AssistantCommandBypassTier,
  AssistantCommandConflict,
  AssistantCommandDefinition,
  AssistantCommandRegistry,
} from "./commandTypes";

const BYPASS_TIERS: readonly AssistantCommandBypassTier[] = [
  "always",
  "connecting",
  "immediate-ui",
  "side-effect-free",
  "queued",
];
const COMMAND_NAME = /^\/[a-z0-9][a-z0-9._:-]*(?: [a-z0-9][a-z0-9._:-]*)*$/;

function normalizeName(name: string): `/${string}` {
  return name.trim().toLocaleLowerCase().replace(/\s+/g, " ") as `/${string}`;
}

function commandNames(command: AssistantCommandDefinition): string[] {
  return [command.path, ...command.aliases];
}

function normalizeCommand(command: AssistantCommandDefinition): AssistantCommandDefinition {
  return {
    ...command,
    path: normalizeName(command.path),
    aliases: command.aliases.map(normalizeName),
  };
}

function isMalformed(command: AssistantCommandDefinition): boolean {
  const names = commandNames(command);
  if (!command.id.trim() || names.some((name) => !COMMAND_NAME.test(name))) return true;
  // A pi command carries literal text (pi's own description, in pi's words) and a name to send over the bridge.
  if (command.kind === "pi") {
    if (!command.commandName.trim()) return true;
    if (command.venue === "unavailable" && !command.unavailableReason?.trim()) return true;
    return [command.description, command.argumentHint]
      .filter((text) => text !== undefined)
      .some((text) => text.kind !== "literal");
  }
  if (command.kind !== "skill") return false;
  if (!command.skillId.trim() || !command.source.fingerprint.trim()) return true;
  return [command.description, command.argumentHint]
    .filter((text) => text !== undefined)
    .some((text) => text.kind !== "literal");
}

function conflict(
  command: AssistantCommandDefinition,
  reason: AssistantCommandConflict["reason"],
  name: string = command.path,
  ownerId: string = command.id,
): AssistantCommandConflict {
  return { commandId: command.id, name, ownerId, reason };
}

export function createAssistantCommandRegistry(
  revision: string,
  sources: readonly (readonly AssistantCommandDefinition[])[],
): AssistantCommandRegistry {
  const conflicts: AssistantCommandConflict[] = [];
  const candidates = sources
    .flat()
    .map(normalizeCommand)
    .filter((command) => {
      if (!isMalformed(command)) return true;
      conflicts.push(conflict(command, "malformed"));
      return false;
    });

  // Names a skill may not claim. Both the app's own commands and pi's own commands own their names: a file dropped
  // into a skills directory must not be able to shadow `/compact` or `/doctor`.
  const reservedOwners = new Map<string, string>();
  for (const command of candidates) {
    if (command.kind === "skill") continue;
    for (const name of commandNames(command)) reservedOwners.set(name, command.id);
  }

  const owners = new Map<string, string>();
  const seenCommandIds = new Set<string>();
  const commands: AssistantCommandDefinition[] = [];
  for (const command of candidates) {
    const names = commandNames(command);
    const commandConflicts: AssistantCommandConflict[] = [];
    const duplicateName = names.find((name, index) => names.indexOf(name) !== index);
    if (duplicateName) commandConflicts.push(conflict(command, "duplicate", duplicateName));
    if (seenCommandIds.has(command.id)) commandConflicts.push(conflict(command, "duplicate-id"));
    seenCommandIds.add(command.id);

    for (const name of names) {
      const reservedOwner = reservedOwners.get(name);
      if (command.kind === "skill" && reservedOwner) {
        commandConflicts.push(conflict(command, "reserved", name, reservedOwner));
      }
      const owner = owners.get(name);
      if (owner && owner !== command.id) commandConflicts.push(conflict(command, "duplicate", name, owner));
    }
    if (
      command.kind === "skill" &&
      names.some((name) => !name.startsWith("/skill:")) &&
      commandConflicts.length === 0
    ) {
      commandConflicts.push(conflict(command, "malformed"));
    }
    if (commandConflicts.length > 0) {
      conflicts.push(...commandConflicts);
      continue;
    }
    commands.push(command);
    for (const name of names) owners.set(name, command.id);
  }

  const byBypassTier: Record<AssistantCommandBypassTier, readonly AssistantCommandDefinition[]> = {
    always: [],
    connecting: [],
    "immediate-ui": [],
    "side-effect-free": [],
    queued: [],
  };
  for (const tier of BYPASS_TIERS) {
    byBypassTier[tier] = commands.filter((command) => command.bypassTier === tier);
  }

  const byName: Record<string, AssistantCommandDefinition | undefined> = {};
  const lookup = commands.flatMap((command) =>
    commandNames(command).map((name) => {
      byName[name] = command;
      return { name, command, pathLength: name.split(" ").length };
    }),
  );

  return {
    revision,
    commands,
    conflicts,
    reservedNames: [...reservedOwners.keys()],
    byName,
    lookup,
    byBypassTier,
  };
}
