// What the loaded plugins contribute — extensions, their commands, skills and prompt templates — flattened
// for the GUI and labelled with the package each came from.
//
// Attribution is pi's own, not a guess: every loaded resource carries a `SourceInfo`, and `origin: "package"`
// means `source` is the package source string that brought it in. Anything the user dropped straight into the
// agent directory comes back `origin: "top-level"` and stays unattributed, which is what a plugin table wants.
import { PI_BUILTIN_COMMANDS } from "@/pi-agent-host/piCommands";
import type { ContributedResource, ContributedResources } from "@/pi-bridge/protocol";

interface PiSourceInfo {
  source: string;
  origin: "package" | "top-level";
}

interface PiNamedResource {
  name: string;
  description?: string;
  sourceInfo?: PiSourceInfo;
}

interface PiLoadedExtension {
  path: string;
  sourceInfo?: PiSourceInfo;
  commands?: Map<string, PiNamedResource>;
}

// The three loader accessors this module reads, declared locally so it is testable without a real
// DefaultResourceLoader (which would need a filesystem and a settings manager).
export interface ResourceLoaderLike {
  getExtensions(): { extensions: PiLoadedExtension[] };
  getSkills(): { skills: PiNamedResource[] };
  getPrompts(): { prompts: PiNamedResource[] };
}

function packageSource(sourceInfo: PiSourceInfo | undefined): string | undefined {
  return sourceInfo?.origin === "package" ? sourceInfo.source : undefined;
}

function named(resource: PiNamedResource, source = packageSource(resource.sourceInfo)): ContributedResource {
  return {
    name: resource.name,
    ...(resource.description === undefined ? {} : { description: resource.description }),
    ...(source === undefined ? {} : { source }),
  };
}

export function collectResources(loader: ResourceLoaderLike): ContributedResources {
  const extensions: ContributedResources["extensions"] = [];
  const commands: ContributedResource[] = [];
  for (const extension of loader.getExtensions().extensions) {
    const source = packageSource(extension.sourceInfo);
    extensions.push({ path: extension.path, ...(source === undefined ? {} : { source }) });
    for (const command of extension.commands?.values() ?? []) {
      // A command registered by one package but declared through another's extension keeps its own label.
      commands.push(named(command, packageSource(command.sourceInfo) ?? source));
    }
  }
  return {
    extensions,
    commands,
    skills: loader.getSkills().skills.map((skill) => named(skill)),
    prompts: loader.getPrompts().prompts.map((prompt) => named(prompt)),
    // pi's own commands, reported alongside what the plugins contributed: the palette showed only the latter, so
    // everything a user of pi already knows how to type looked like it did not exist here.
    builtins: [...PI_BUILTIN_COMMANDS],
  };
}
