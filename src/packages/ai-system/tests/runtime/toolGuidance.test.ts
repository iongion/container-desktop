import { describe, expect, it } from "vitest";

import { buildToolGuidance } from "@/ai-system/runtime/toolGuidance";
import type { Toolset } from "@/ai-system/runtime/tools/toolset";

function toolset(): Toolset {
  const names = new Set(["readFile", "execCommand"]);
  return {
    defs: [
      { name: "readFile", description: "Read one workspace file.", inputSchema: {} },
      { name: "execCommand", description: "Run one workspace command.", inputSchema: {} },
    ],
    has: (name) => names.has(name),
    gated: (name) => name === "execCommand",
    title: (name) => name,
    validate: (_name, input) => ({ ok: true, value: input }),
    run: async () => ({ ok: true, result: null, summary: null }),
  };
}

describe("buildToolGuidance", () => {
  it("lists only registered tools and marks gated entries", () => {
    const guidance = buildToolGuidance(toolset());

    expect(guidance).toContain("`readFile`");
    expect(guidance).toContain("`execCommand` — approval-gated");
    expect(guidance).not.toContain("runCommand");
    expect(guidance).not.toContain("searchKnowledge");
    expect(guidance).not.toContain("webSearch");
  });

  it("states when the runner registered no tools", () => {
    expect(buildToolGuidance(null)).toContain("No tools are available");
  });
});
