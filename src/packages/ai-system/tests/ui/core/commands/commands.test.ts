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
    availabilityId: "thread-idle",
    confirmation: "none",
    arguments: { kind: "text", required: false },
    surfaces: ["assistant", "quake-console"],
    ...overrides,
  };
}

describe("assistant command registry", () => {
  it("contains only implemented Thread controls", () => {
    expect(BUILTIN_ASSISTANT_COMMANDS.map((command) => command.id)).toEqual([
      "help",
      "skills.open",
      "skills.reload",
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
      "thread.list",
      "thread.new",
      "thread.switch",
      "thread.rename",
      "thread.branch",
      "thread.compact",
      "thread.delete",
      "thread.stop",
      "thread.copy",
      "thread.export",
      "model.open",
      "access.set",
      "reasoning.set",
      "permissions.open",
      "worker.list",
      "worker.show",
      "worker.create",
      "run.start",
      "run.list",
      "run.show",
      "run.stop",
    ]);
    const names = BUILTIN_ASSISTANT_COMMANDS.flatMap((command) => [command.path, ...command.aliases]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("derives bypass tiers and reserved names from one registry", () => {
    expect(BUILTIN_ASSISTANT_COMMAND_REGISTRY.byBypassTier.always.map(({ id }) => id)).toEqual([
      "thread.stop",
      "run.stop",
    ]);
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
      "thread.list",
      "thread.branch",
      "thread.compact",
      "thread.export",
      "model.open",
      "access.set",
      "reasoning.set",
      "permissions.open",
      "worker.list",
      "worker.show",
      "worker.create",
      "run.list",
      "run.show",
    ]);
    expect(BUILTIN_ASSISTANT_COMMAND_REGISTRY.reservedNames).toContain("/clear");
    expect(BUILTIN_ASSISTANT_COMMAND_REGISTRY.byName["/resume"]?.id).toBe("thread.list");
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

  it("resolves canonical Thread commands and compatibility aliases", () => {
    expect(parseAssistantInput("/thread list", BUILTIN_ASSISTANT_COMMAND_REGISTRY)).toMatchObject({
      kind: "command",
      id: "thread.list",
      args: [],
    });
    expect(parseAssistantInput("/clear", BUILTIN_ASSISTANT_COMMAND_REGISTRY)).toMatchObject({
      kind: "command",
      id: "thread.new",
      args: [],
    });
    expect(parseAssistantInput("/resume", BUILTIN_ASSISTANT_COMMAND_REGISTRY)).toMatchObject({
      kind: "command",
      id: "thread.list",
      args: [],
    });
    expect(parseAssistantInput("/branch checkpoint-1", BUILTIN_ASSISTANT_COMMAND_REGISTRY)).toMatchObject({
      kind: "command",
      id: "thread.branch",
      args: ["checkpoint-1"],
    });
  });

  it("resolves access and reasoning compatibility aliases", () => {
    expect(parseAssistantInput("/security workspace", BUILTIN_ASSISTANT_COMMAND_REGISTRY)).toMatchObject({
      kind: "command",
      id: "access.set",
      args: ["workspace"],
    });
    for (const alias of ["/effort", "/thinking", "/think"]) {
      expect(parseAssistantInput(`${alias} high`, BUILTIN_ASSISTANT_COMMAND_REGISTRY)).toMatchObject({
        kind: "command",
        id: "reasoning.set",
        args: ["high"],
      });
    }
  });

  it("parses bounded text without shell expansion", () => {
    expect(parseAssistantInput('/thread rename "Release triage"', BUILTIN_ASSISTANT_COMMAND_REGISTRY)).toMatchObject({
      kind: "command",
      id: "thread.rename",
      args: ["Release triage"],
    });
    expect(parseAssistantInput('/thread rename "Say \\"go\\""', BUILTIN_ASSISTANT_COMMAND_REGISTRY)).toMatchObject({
      kind: "command",
      id: "thread.rename",
      args: ['Say "go"'],
    });
    expect(parseAssistantInput("/thread rename $(touch nope)", BUILTIN_ASSISTANT_COMMAND_REGISTRY)).toMatchObject({
      kind: "command",
      args: ["$(touch nope)"],
    });
  });

  it("parses native application routes and their compatibility aliases", () => {
    expect(parseAssistantInput("/worker open Inspector", BUILTIN_ASSISTANT_COMMAND_REGISTRY)).toMatchObject({
      kind: "command",
      id: "worker.show",
      args: ["Inspector"],
    });
    expect(parseAssistantInput("/plan Audit all images", BUILTIN_ASSISTANT_COMMAND_REGISTRY)).toMatchObject({
      kind: "command",
      id: "run.start",
      args: ["Audit all images"],
    });
    expect(parseAssistantInput("/run stop run-1", BUILTIN_ASSISTANT_COMMAND_REGISTRY)).toMatchObject({
      kind: "command",
      id: "run.stop",
      args: ["run-1"],
    });
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
    expect(parseAssistantInput("/thred new", BUILTIN_ASSISTANT_COMMAND_REGISTRY)).toMatchObject({
      kind: "error",
      code: "unknown-command",
      suggestions: expect.arrayContaining(["thread.new"]),
    });
    expect(parseAssistantInput('/thread rename "broken', BUILTIN_ASSISTANT_COMMAND_REGISTRY)).toMatchObject({
      kind: "error",
      code: "unterminated-quote",
    });
    expect(parseAssistantInput("/thread rename", BUILTIN_ASSISTANT_COMMAND_REGISTRY)).toMatchObject({
      kind: "error",
      code: "missing-argument",
    });
    expect(parseAssistantInput("/thread stop now", BUILTIN_ASSISTANT_COMMAND_REGISTRY)).toMatchObject({
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
    expect(
      completeCommands("/thread ren", BUILTIN_ASSISTANT_COMMAND_REGISTRY).map((match) => match.command.id),
    ).toEqual(["thread.rename"]);
    expect(completeCommands("/res", BUILTIN_ASSISTANT_COMMAND_REGISTRY)[0]?.command.id).toBe("thread.list");
    expect(completeCommands("history", BUILTIN_ASSISTANT_COMMAND_REGISTRY).map((match) => match.command.id)).toContain(
      "thread.list",
    );
  });

  it("ranks an exact alias before longer prefix matches", () => {
    const ids = completeCommands("/thread", BUILTIN_ASSISTANT_COMMAND_REGISTRY).map((match) => match.command.id);
    expect(ids[0]).toBe("thread.list");
    expect(ids).toContain("thread.rename");
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
