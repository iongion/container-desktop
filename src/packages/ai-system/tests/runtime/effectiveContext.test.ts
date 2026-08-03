import type { LLMMessage } from "@open-multi-agent/core";
import { describe, expect, it } from "vitest";

import { buildEffectiveContextSnapshot } from "@/ai-system/runtime/effectiveContext";
import type { Toolset } from "@/ai-system/runtime/tools/toolset";

const toolset: Toolset = {
  defs: [
    { name: "listContainers", description: "List containers", inputSchema: { type: "object" } },
    { name: "readFile", description: "Read a file", inputSchema: { type: "object" } },
  ],
  has: () => true,
  gated: (name) => name === "readFile",
  title: (name) => (name === "readFile" ? "Read File" : "List Containers"),
  validate: () => ({ ok: true, value: {} }),
  run: async () => ({ ok: true, result: {}, summary: {} }),
};

describe("buildEffectiveContextSnapshot", () => {
  it("describes the exact adapter request without exposing message or prompt content", () => {
    const history: LLMMessage[] = [{ role: "user", content: [{ type: "text", text: "old secret" }] }];
    const turn: LLMMessage[] = [{ role: "user", content: [{ type: "text", text: "new secret" }] }];
    const snapshot = buildEffectiveContextSnapshot({
      providerId: "openrouter",
      model: "model-a",
      systemPrompt: "system secret",
      history,
      turn,
      tools: toolset.defs,
      toolset,
      permissionMode: "remember",
      sources: [{ kind: "screen", trust: "application", characters: 42 }],
      capturedAt: 123,
    });

    expect(snapshot).toMatchObject({
      providerId: "openrouter",
      model: "model-a",
      capturedAt: 123,
      window: { status: "unknown" },
      truncation: { applied: false, omittedMessages: 0 },
      permissionMode: "remember",
      sections: [
        { kind: "system", items: 1 },
        { kind: "history", items: 1 },
        { kind: "turn", items: 1 },
        { kind: "tools", items: 2 },
      ],
      tools: [
        { name: "listContainers", title: "List Containers", group: "container", gated: false },
        { name: "readFile", title: "Read File", group: "workspace", gated: true },
      ],
      sources: [{ kind: "screen", trust: "application", characters: 42 }],
    });
    expect(snapshot.totals.characters).toBe(snapshot.sections.reduce((sum, section) => sum + section.characters, 0));
    expect(snapshot.totals.estimatedTokens).toBeGreaterThan(0);
    expect(JSON.stringify(snapshot)).not.toContain("secret");
  });
});
