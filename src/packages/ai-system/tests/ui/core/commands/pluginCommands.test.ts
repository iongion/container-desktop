import { describe, expect, it } from "vitest";

import { pluginCommandsFromResources } from "@/ai-system/ui/core/commands/pluginCommands";

const RESOURCES = {
  extensions: [],
  commands: [{ name: "probe", description: "Probe the host", source: "npm:@foo/bar" }],
  skills: [{ name: "search", description: "Web search", source: "npm:@foo/bar" }],
  prompts: [{ name: "deploy", description: "Deploy the app", source: "npm:@foo/bar" }],
};

describe("pluginCommandsFromResources", () => {
  it("turns an extension command into a slash command attributed to its package", () => {
    const commands = pluginCommandsFromResources(RESOURCES);
    const probe = commands.find((command) => command.path === "/probe");
    expect(probe).toMatchObject({
      kind: "skill",
      path: "/probe",
      description: { kind: "literal", value: "Probe the host" },
      source: { kind: "plugin-skill", pluginId: "npm:@foo/bar" },
    });
  });

  // pi invokes a skill explicitly as `/skill:<name>`, so that is the text the composer must insert.
  it("prefixes a skill with skill:", () => {
    const commands = pluginCommandsFromResources(RESOURCES);
    expect(commands.map((command) => command.path)).toContain("/skill:search");
  });

  it("turns a prompt template into a slash command", () => {
    const commands = pluginCommandsFromResources(RESOURCES);
    expect(commands.find((command) => command.path === "/deploy")).toBeDefined();
  });

  it("keeps the three kinds in separate palette categories", () => {
    const categories = pluginCommandsFromResources(RESOURCES).map((command) => command.category);
    expect(categories).toEqual([
      { kind: "i18n", key: "Plugin commands" },
      { kind: "i18n", key: "Plugin skills" },
      { kind: "i18n", key: "Plugin prompts" },
    ]);
  });

  it("gives every command a distinct id so the registry keeps them all", () => {
    const ids = pluginCommandsFromResources({
      ...RESOURCES,
      commands: [
        { name: "probe", source: "npm:@foo/bar" },
        { name: "probe", source: "npm:@foo/other" },
      ],
    }).map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("falls back to a description that at least names the package", () => {
    const commands = pluginCommandsFromResources({
      ...RESOURCES,
      commands: [{ name: "bare", source: "npm:@foo/bar" }],
      skills: [],
      prompts: [],
    });
    expect(commands[0].description).toEqual({ kind: "literal", value: "npm:@foo/bar" });
  });

  it("still lists an unattributed contribution", () => {
    const commands = pluginCommandsFromResources({
      extensions: [],
      commands: [{ name: "orphan" }],
      skills: [],
      prompts: [],
    });
    expect(commands[0]).toMatchObject({ path: "/orphan", source: { kind: "plugin-skill", pluginId: "local" } });
  });

  it("drops a name that cannot be a slash command", () => {
    const commands = pluginCommandsFromResources({
      extensions: [],
      commands: [{ name: "" }, { name: "has space" }, { name: "ok" }],
      skills: [],
      prompts: [],
    });
    expect(commands.map((command) => command.path)).toEqual(["/ok"]);
  });

  it("returns nothing when no plugin contributes anything", () => {
    expect(pluginCommandsFromResources({ extensions: [], commands: [], skills: [], prompts: [] })).toEqual([]);
  });
});
