import { describe, expect, it } from "vitest";

import {
  buildProjectContextPack,
  PROJECT_CONTEXT_LIMITS,
  type ProjectMemoryEntry,
  parseProjectContextStore,
  parseProjectMemoryImport,
  prepareProjectContextStore,
  prepareProjectMemoryExport,
} from "@/ai-system/core/projectContext";

const hash = async () => "a".repeat(64);

function memory(overrides: Partial<ProjectMemoryEntry> = {}): ProjectMemoryEntry {
  return {
    id: "memory-1",
    content: "Prefer focused tests.",
    source: "user",
    createdAt: 20,
    updatedAt: 20,
    ...overrides,
  };
}

describe("project context pack", () => {
  it("builds one deterministic, provenance-visible, redacted and initially tainted pack", async () => {
    const token = "ghp_aaaaaaaaaaaaaaaaaaaaaa";

    const pack = await buildProjectContextPack({
      workspaceId: "b".repeat(64),
      workspaceRoot: "/workspace",
      capturedAt: 30,
      rulesEnabled: true,
      rules: [
        {
          path: "CLAUDE.md",
          content: "Second rule.",
          size: 12,
          modifiedAt: 12,
          fingerprint: "c".repeat(64),
        },
        {
          path: "AGENTS.md",
          content: `Never expose ${token}.`,
          size: 40,
          modifiedAt: 10,
          fingerprint: "d".repeat(64),
        },
      ],
      memory: [memory()],
      fingerprint: hash,
    });

    expect(pack.sections.map(({ kind, source }) => [kind, source])).toEqual([
      ["rules", "AGENTS.md"],
      ["rules", "CLAUDE.md"],
      ["memory", "memory:memory-1"],
    ]);
    expect(pack.sections[0]?.content).toBe("Never expose [REDACTED].");
    expect(pack.sections.map(({ trust }) => trust)).toEqual(["project", "project", "user"]);
    expect(pack.initialTaint).toBe(true);
    expect(pack.truncated).toBe(false);
    expect(pack.omittedSources).toBe(0);
    expect(pack.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("enforces per-source and total byte budgets without splitting Unicode", async () => {
    const pack = await buildProjectContextPack({
      workspaceId: "b".repeat(64),
      workspaceRoot: "/workspace",
      capturedAt: 30,
      rulesEnabled: true,
      rules: Array.from({ length: 8 }, (_, index) => ({
        path: index === 0 ? "AGENTS.md" : `.container-desktop/rules/${index}.md`,
        content: "🙂".repeat(PROJECT_CONTEXT_LIMITS.sourceBytes),
        size: PROJECT_CONTEXT_LIMITS.sourceBytes * 4,
        modifiedAt: index,
        fingerprint: String(index).padStart(64, "0"),
      })),
      memory: [],
      fingerprint: hash,
    });

    expect(pack.usedBytes).toBeLessThanOrEqual(PROJECT_CONTEXT_LIMITS.packBytes);
    expect(pack.truncated).toBe(true);
    expect(pack.sections.every(({ content }) => !content.endsWith("\uFFFD"))).toBe(true);
  });
});

describe("project memory persistence", () => {
  it("fails closed on invalid data and prepares bounded workspace-keyed records", () => {
    expect(parseProjectContextStore("{not-json")).toEqual({ status: "error", workspaces: [] });

    const file = prepareProjectContextStore([
      {
        workspaceId: "b".repeat(64),
        workspaceRoot: "/workspace",
        rulesEnabled: true,
        memory: [memory()],
      },
    ]);

    expect(parseProjectContextStore(JSON.stringify(file))).toEqual({
      status: "ok",
      workspaces: file.workspaces,
    });
  });

  it("exports no workspace path and redacts imported memory before it can be persisted", () => {
    const exported = prepareProjectMemoryExport([memory()]);
    const text = JSON.stringify(exported);

    expect(text).not.toContain("/workspace");
    expect(parseProjectMemoryImport(text)).toEqual([
      {
        content: "Prefer focused tests.",
        createdAt: 20,
        updatedAt: 20,
      },
    ]);

    const token = "ghp_aaaaaaaaaaaaaaaaaaaaaa";
    expect(parseProjectMemoryImport(JSON.stringify({ version: 1, entries: [{ content: `token ${token}` }] }))).toEqual([
      { content: "token [REDACTED]" },
    ]);
  });
});
