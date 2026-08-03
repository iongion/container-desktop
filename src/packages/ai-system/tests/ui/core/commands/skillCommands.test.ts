import { describe, expect, it } from "vitest";

import type { SkillHostSnapshot, SkillViewDescriptor } from "@/ai-system/core/skills";
import { createSkillCommandRegistry, skillCommandsFromSnapshot } from "@/ai-system/ui/core/commands/skillCommands";

function skill(overrides: Partial<SkillViewDescriptor> = {}): SkillViewDescriptor {
  return {
    id: "skill:user:review-pr",
    command: "/skill:user:review-pr",
    shortCommand: "/skill:review-pr",
    name: "review-pr",
    description: "Review the current pull request",
    argumentHint: "[focus]",
    source: { kind: "user" },
    fingerprint: "fingerprint-user",
    enabled: true,
    trusted: true,
    ...overrides,
  };
}

function snapshot(skills: SkillViewDescriptor[]): SkillHostSnapshot {
  return { revision: "7", user: { root: "/data/skills", status: "ok" }, skills, diagnostics: [] };
}

describe("skill commands", () => {
  it("maps executable host descriptors without moving trust decisions into the renderer", () => {
    const project = skill({
      id: "skill:project:audit",
      command: "/skill:project:audit",
      shortCommand: "/skill:audit",
      name: "audit",
      source: { kind: "project", workspaceId: "workspace-1" },
      fingerprint: "fingerprint-project",
      allowedTools: ["listContainers"],
    });

    expect(skillCommandsFromSnapshot(snapshot([skill(), project]))).toEqual([
      expect.objectContaining({
        kind: "skill",
        skillId: "skill:user:review-pr",
        path: "/skill:user:review-pr",
        aliases: ["/skill:review-pr"],
        category: { kind: "i18n", key: "User skills" },
        source: { kind: "user-skill", fingerprint: "fingerprint-user" },
        arguments: { kind: "text", required: false },
      }),
      expect.objectContaining({
        skillId: "skill:project:audit",
        source: {
          kind: "project-skill",
          workspaceId: "workspace-1",
          fingerprint: "fingerprint-project",
        },
      }),
    ]);
  });

  it("omits disabled and untrusted skills", () => {
    expect(
      skillCommandsFromSnapshot(
        snapshot([
          skill({ enabled: false }),
          skill({ id: "skill:project:unsafe", trusted: false, source: { kind: "project", workspaceId: "ws" } }),
        ]),
      ),
    ).toEqual([]);
  });

  it("combines the host revision with built-ins and preserves host-resolved alias collisions", () => {
    const registry = createSkillCommandRegistry(
      snapshot([
        skill(),
        skill({ id: "skill:project:review-pr", command: "/skill:project:review-pr", shortCommand: undefined }),
      ]),
    );

    expect(registry.revision).toContain("skills:7");
    expect(registry.byName["/help"]?.id).toBe("help");
    expect(registry.byName["/skill:review-pr"]?.id).toBe("skill:user:review-pr");
    expect(registry.byName["/skill:project:review-pr"]?.id).toBe("skill:project:review-pr");
  });
});
