import { describe, expect, it } from "vitest";
import { piPluginCommandDefinitions } from "@/ai-system/ui/core/commands/piSessionCommands";
import { pluginSkillCommands } from "@/ai-system/ui/core/commands/pluginCommands";
import type { ContributedResources } from "@/pi-bridge/protocol";

const RESOURCES: ContributedResources = {
  extensions: [],
  commands: [{ name: "probe", description: "Probe the host", source: "npm:@foo/bar" }],
  skills: [{ name: "search", description: "Web search", source: "npm:@foo/bar" }],
  prompts: [{ name: "deploy", description: "Deploy the app", source: "npm:@foo/bar" }],
  builtins: [],
};

describe("piPluginCommandDefinitions", () => {
  // A plugin's command owns its name in pi, so it is a pi command here too — NOT a skill. Built as a skill it was
  // dropped by the registry, which only lets a skill answer to `/skill:<name>`.
  it("turns an extension command into a pi command attributed to its package", () => {
    const probe = piPluginCommandDefinitions(RESOURCES).find((command) => command.path === "/probe");
    expect(probe).toMatchObject({
      kind: "pi",
      venue: "prompt",
      commandName: "probe",
      path: "/probe",
      description: { kind: "literal", value: "Probe the host" },
      source: { kind: "pi-plugin", pluginId: "npm:@foo/bar" },
    });
  });

  it("turns a prompt template into a command of its own", () => {
    expect(piPluginCommandDefinitions(RESOURCES).find((command) => command.path === "/deploy")).toBeDefined();
  });

  it("keeps commands and prompts in separate palette categories", () => {
    expect(piPluginCommandDefinitions(RESOURCES).map((command) => command.category)).toEqual([
      { kind: "i18n", key: "Plugin commands" },
      { kind: "i18n", key: "Plugin prompts" },
    ]);
  });

  it("gives every command a distinct id so the registry keeps them all", () => {
    const ids = piPluginCommandDefinitions({
      ...RESOURCES,
      commands: [
        { name: "probe", source: "npm:@foo/bar" },
        { name: "probe", source: "npm:@foo/other" },
      ],
    }).map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("falls back to a description that at least names the package", () => {
    const commands = piPluginCommandDefinitions({
      ...RESOURCES,
      commands: [{ name: "bare", source: "npm:@foo/bar" }],
      prompts: [],
    });
    expect(commands[0].description).toEqual({ kind: "literal", value: "npm:@foo/bar" });
  });

  it("still lists an unattributed contribution", () => {
    const commands = piPluginCommandDefinitions({ ...RESOURCES, commands: [{ name: "orphan" }], prompts: [] });
    expect(commands[0]).toMatchObject({ path: "/orphan", source: { kind: "pi-plugin", pluginId: "local" } });
  });

  it("drops a name that cannot be a slash command", () => {
    const commands = piPluginCommandDefinitions({
      ...RESOURCES,
      commands: [{ name: "" }, { name: "has space" }, { name: "ok" }],
      prompts: [],
    });
    expect(commands.map((command) => command.path)).toEqual(["/ok"]);
  });

  it("returns nothing when no plugin contributes anything", () => {
    expect(piPluginCommandDefinitions({ ...RESOURCES, commands: [], prompts: [] })).toEqual([]);
  });
});

describe("pluginSkillCommands", () => {
  // pi invokes a skill explicitly as `/skill:<name>`, so that is the text the composer must insert — and the only
  // shape the registry accepts for something a package dropped in.
  it("prefixes a plugin's skill with skill:", () => {
    const skills = pluginSkillCommands(RESOURCES);
    expect(skills.map((skill) => skill.path)).toEqual(["/skill:search"]);
    expect(skills[0]).toMatchObject({
      kind: "skill",
      skillId: "skill:search",
      source: { kind: "plugin-skill", pluginId: "npm:@foo/bar" },
    });
  });

  it("returns nothing when a plugin contributes no skill", () => {
    expect(pluginSkillCommands({ ...RESOURCES, skills: [] })).toEqual([]);
  });
});
