import { describe, expect, it } from "vitest";

import {
  BUILTIN_ASSISTANT_COMMAND_REGISTRY,
  BUILTIN_ASSISTANT_COMMANDS,
} from "@/ai-system/ui/core/commands/commandCatalog";
import { createAssistantCommandRegistry } from "@/ai-system/ui/core/commands/commandRegistry";
import type { AssistantSkillCommandDefinition } from "@/ai-system/ui/core/commands/commandTypes";
import { completeCommands } from "@/ai-system/ui/core/commands/completeCommand";
import { parseAssistantInput } from "@/ai-system/ui/core/commands/parseCommand";

function userSkill(overrides: Partial<AssistantSkillCommandDefinition> = {}): AssistantSkillCommandDefinition {
  return {
    id: "skill.user.review-pr",
    kind: "skill",
    skillId: "user:review-pr",
    source: { kind: "user-skill", fingerprint: "sha256:test" },
    path: "/skill:user:review-pr",
    aliases: ["/skill:review-pr"],
    category: { kind: "literal", value: "Skills" },
    description: { kind: "literal", value: "Review the current pull request" },
    hiddenSearchTerms: ["pull request", "review"],
    argumentHint: { kind: "literal", value: "[focus]" },
    bypassTier: "queued",
    availabilityId: "session-idle",
    confirmation: "none",
    arguments: { kind: "text", required: false },
    surfaces: ["assistant", "quake-console"],
    ...overrides,
  };
}

describe("assistant command registry", () => {
  // What the APP performs. Everything pi performs is reported by the session under pi's own name (see
  // piSessionCommands.test.ts), and every one of these that shares a name with one of pi's — /new, /quit, /session,
  // /copy, /export, /import, /share, /login, /logout, /model, /reload — carries pi's name and pi's meaning, not a
  // variant of it.
  it("contains only the commands the app itself performs", () => {
    expect(BUILTIN_ASSISTANT_COMMANDS.map((command) => command.id)).toEqual([
      "help",
      "skills.open",
      "reload",
      "context.usage",
      "context.tools",
      "diagnostics.open",
      "changes.status",
      "changes.diff",
      "memory.list",
      "memory.add",
      "memory.remove",
      "memory.clear",
      "rules.list",
      "rules.init",
      "session.new",
      "session.quit",
      "session.info",
      "turn.stop",
      "session.copy",
      "session.export",
      "session.import",
      "session.share",
      "provider.login",
      "provider.logout",
      "model.open",
      "permissions.open",
    ]);
    const names = BUILTIN_ASSISTANT_COMMANDS.flatMap((command) => [command.path, ...command.aliases]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("derives bypass tiers and reserved names from one registry", () => {
    expect(BUILTIN_ASSISTANT_COMMAND_REGISTRY.byBypassTier.always.map(({ id }) => id)).toEqual(["turn.stop"]);
    expect(BUILTIN_ASSISTANT_COMMAND_REGISTRY.byBypassTier["immediate-ui"].map(({ id }) => id)).toEqual([
      "help",
      "skills.open",
      "context.usage",
      "context.tools",
      "diagnostics.open",
      "changes.status",
      "changes.diff",
      "memory.list",
      "memory.add",
      "memory.remove",
      "memory.clear",
      "rules.list",
      "rules.init",
      "session.info",
      "session.export",
      "session.share",
      "provider.login",
      "provider.logout",
      "model.open",
      "permissions.open",
    ]);
    // Every name the app owns is reserved against a skill claiming it. `/resume` is NOT among them: it is pi's and the
    // SESSION performs it, so the palette entry comes from what the session reports rather than from this catalogue.
    expect(BUILTIN_ASSISTANT_COMMAND_REGISTRY.reservedNames).toContain("/new");
    expect(BUILTIN_ASSISTANT_COMMAND_REGISTRY.byName["/resume"]).toBeUndefined();
  });

  it("accepts source-qualified prompt skills without changing parser types", () => {
    const skill = userSkill();
    const registry = createAssistantCommandRegistry("test-revision", [BUILTIN_ASSISTANT_COMMANDS, [skill]]);

    expect(parseAssistantInput("/skill:user:review-pr security and permissions", registry)).toMatchObject({
      kind: "command",
      id: "skill.user.review-pr",
      args: ["security and permissions"],
      rawArguments: "security and permissions",
      command: { kind: "skill", skillId: "user:review-pr" },
    });
  });

  it("reserves built-in names and isolates dynamic collisions", () => {
    const collidingSkill = userSkill({
      id: "skill.project.help",
      skillId: "project:help",
      source: {
        kind: "project-skill",
        workspaceId: "workspace",
        fingerprint: "sha256:test",
      },
      path: "/help",
      aliases: [],
    });
    const registry = createAssistantCommandRegistry("test-revision", [BUILTIN_ASSISTANT_COMMANDS, [collidingSkill]]);

    expect(registry.commands).not.toContainEqual(collidingSkill);
    expect(registry.conflicts).toContainEqual({
      commandId: "skill.project.help",
      name: "/help",
      ownerId: "help",
      reason: "reserved",
    });
  });

  it("normalizes names once and exposes the derived lookup", () => {
    const skill = userSkill({
      path: "/skill:USER:review-pr",
      aliases: ["/skill:Review-Pr"],
    });
    const registry = createAssistantCommandRegistry("test-revision", [BUILTIN_ASSISTANT_COMMANDS, [skill]]);

    expect(registry.byName["/skill:user:review-pr"]?.id).toBe(skill.id);
    expect(registry.byName["/skill:review-pr"]?.id).toBe(skill.id);
    expect(registry.commands.at(-1)).toMatchObject({
      path: "/skill:user:review-pr",
      aliases: ["/skill:review-pr"],
    });
  });

  it("isolates malformed dynamic entries without dropping built-ins", () => {
    const wrongNamespace = userSkill({ path: "/review-pr", aliases: [] });
    const translatedDiskText = userSkill({
      id: "skill.user.translated",
      skillId: "user:translated",
      path: "/skill:user:translated",
      aliases: [],
      description: { kind: "i18n", key: "Untrusted key" },
    });
    const registry = createAssistantCommandRegistry("test-revision", [
      BUILTIN_ASSISTANT_COMMANDS,
      [wrongNamespace, translatedDiskText],
    ]);

    expect(registry.commands).toEqual(BUILTIN_ASSISTANT_COMMANDS);
    expect(registry.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ commandId: wrongNamespace.id, reason: "malformed" }),
        expect.objectContaining({ commandId: translatedDiskText.id, reason: "malformed" }),
      ]),
    );
  });

  it("isolates duplicate names within one entry and duplicate command IDs", () => {
    const duplicateAlias = userSkill({ aliases: ["/skill:user:review-pr"] });
    const duplicateId = userSkill({ path: "/skill:user:other", aliases: [] });
    const registry = createAssistantCommandRegistry("test-revision", [
      BUILTIN_ASSISTANT_COMMANDS,
      [duplicateAlias, duplicateId],
    ]);

    expect(registry.commands).toEqual(BUILTIN_ASSISTANT_COMMANDS);
    expect(registry.conflicts).toEqual([
      expect.objectContaining({ commandId: duplicateAlias.id, reason: "duplicate" }),
      expect.objectContaining({ commandId: duplicateId.id, reason: "duplicate-id" }),
    ]);
  });
});

describe("parseAssistantInput", () => {
  it("keeps ordinary input as a model message and uses // to escape a leading slash", () => {
    expect(parseAssistantInput("  explain this  ", BUILTIN_ASSISTANT_COMMAND_REGISTRY)).toEqual({
      kind: "message",
      text: "explain this",
    });
    expect(parseAssistantInput("//help me write a path", BUILTIN_ASSISTANT_COMMAND_REGISTRY)).toEqual({
      kind: "message",
      text: "/help me write a path",
    });
  });

  // pi's names mean pi's things. `/new` starts a fresh session because that is what it does in pi; `/clear` and
  // `/branch` are gone rather than kept as aliases pointing at something adjacent.
  it("resolves pi's own names to what pi means by them", () => {
    expect(parseAssistantInput("/new", BUILTIN_ASSISTANT_COMMAND_REGISTRY)).toMatchObject({
      kind: "command",
      id: "session.new",
      args: [],
    });
    expect(parseAssistantInput("/session", BUILTIN_ASSISTANT_COMMAND_REGISTRY)).toMatchObject({
      kind: "command",
      id: "session.info",
      args: [],
    });
    expect(parseAssistantInput("/copy", BUILTIN_ASSISTANT_COMMAND_REGISTRY)).toMatchObject({
      kind: "command",
      id: "session.copy",
    });
    // A pi session takes its access and reasoning AT START, so the app no longer offers a command that could
    // only have changed a value nothing reads.
    for (const gone of [
      "/clear",
      "/cls",
      "/branch",
      "/offload",
      "/session list",
      "/context",
      "/access",
      "/security",
      "/reasoning",
      "/effort",
      "/thinking",
      "/think",
    ]) {
      expect(parseAssistantInput(gone, BUILTIN_ASSISTANT_COMMAND_REGISTRY)).toMatchObject({ kind: "error" });
    }
  });

  it("parses bounded text without shell expansion", () => {
    expect(parseAssistantInput('/remember "Release triage"', BUILTIN_ASSISTANT_COMMAND_REGISTRY)).toMatchObject({
      kind: "command",
      id: "memory.add",
      args: ["Release triage"],
    });
    expect(parseAssistantInput('/remember "Say \\"go\\""', BUILTIN_ASSISTANT_COMMAND_REGISTRY)).toMatchObject({
      kind: "command",
      id: "memory.add",
      args: ['Say "go"'],
    });
    expect(parseAssistantInput("/remember $(touch nope)", BUILTIN_ASSISTANT_COMMAND_REGISTRY)).toMatchObject({
      kind: "command",
      args: ["$(touch nope)"],
    });
  });

  it("parses native application routes and their compatibility aliases", () => {
    expect(parseAssistantInput("/remember Prefer typed ports", BUILTIN_ASSISTANT_COMMAND_REGISTRY)).toMatchObject({
      kind: "command",
      id: "memory.add",
      args: ["Prefer typed ports"],
    });
    expect(parseAssistantInput("/init", BUILTIN_ASSISTANT_COMMAND_REGISTRY)).toMatchObject({
      kind: "command",
      id: "rules.init",
      args: [],
    });
  });

  it("rejects unknown commands, unterminated quotes, and invalid arguments locally", () => {
    expect(parseAssistantInput("/expot", BUILTIN_ASSISTANT_COMMAND_REGISTRY)).toMatchObject({
      kind: "error",
      code: "unknown-command",
      suggestions: expect.arrayContaining(["session.export"]),
    });
    expect(parseAssistantInput('/remember "broken', BUILTIN_ASSISTANT_COMMAND_REGISTRY)).toMatchObject({
      kind: "error",
      code: "unterminated-quote",
    });
    expect(parseAssistantInput("/remember", BUILTIN_ASSISTANT_COMMAND_REGISTRY)).toMatchObject({
      kind: "error",
      code: "missing-argument",
    });
    expect(parseAssistantInput("/stop now", BUILTIN_ASSISTANT_COMMAND_REGISTRY)).toMatchObject({
      kind: "error",
      code: "too-many-arguments",
    });
  });
});

describe("completeCommands", () => {
  it("returns the shipped catalogue for an empty query", () => {
    expect(completeCommands("", BUILTIN_ASSISTANT_COMMAND_REGISTRY).map((match) => match.command.id)).toEqual(
      BUILTIN_ASSISTANT_COMMANDS.map(({ id }) => id),
    );
  });

  it("matches paths, aliases, hidden terms, and descriptions", () => {
    expect(completeCommands("/memory rem", BUILTIN_ASSISTANT_COMMAND_REGISTRY).map((m) => m.command.id)).toEqual([
      "memory.remove",
    ]);
    expect(completeCommands("/qui", BUILTIN_ASSISTANT_COMMAND_REGISTRY)[0]?.command.id).toBe("session.quit");
    // A hidden search term, so someone reaching for the old vocabulary still lands on the command that replaced it.
    expect(completeCommands("session", BUILTIN_ASSISTANT_COMMAND_REGISTRY).map((m) => m.command.id)).toContain(
      "session.new",
    );
  });

  it("ranks an exact name before longer prefix matches", () => {
    const ids = completeCommands("/session", BUILTIN_ASSISTANT_COMMAND_REGISTRY).map((match) => match.command.id);
    expect(ids[0]).toBe("session.info");
    expect(ids).toContain("session.export");
  });

  it("caps matches before an extension catalogue can overload the palette", () => {
    const skills = Array.from({ length: 150 }, (_, index) =>
      userSkill({
        id: `skill.user.test-${index}`,
        skillId: `user:test-${index}`,
        path: `/skill:user:test-${index}`,
        aliases: [],
      }),
    );
    const registry = createAssistantCommandRegistry("many", [skills]);

    expect(completeCommands("/", registry)).toHaveLength(100);
  });
});
