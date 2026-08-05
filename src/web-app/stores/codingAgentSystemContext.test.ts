import { describe, expect, it } from "vitest";

import type { ProjectContextPack, ProjectContextSnapshot } from "@/ai-system/core/projectContext";
import { composeSessionSystemContext } from "@/web-app/stores/codingAgentSystemContext";

const pack = (sections: ProjectContextPack["sections"]): ProjectContextPack => ({
  workspaceId: "w1",
  workspaceRoot: "/work",
  capturedAt: 1,
  fingerprint: "fp",
  sections,
  budgetBytes: 1024,
  usedBytes: sections.reduce((total, section) => total + section.includedBytes, 0),
  omittedSources: 0,
  truncated: false,
  initialTaint: sections.length > 0,
});

const section = (
  kind: "rules" | "memory",
  source: string,
  content: string,
): ProjectContextPack["sections"][number] => ({
  kind,
  source,
  trust: kind === "rules" ? "project" : "user",
  content,
  fingerprint: `fp-${source}`,
  modifiedAt: 2,
  originalBytes: content.length,
  includedBytes: content.length,
  truncated: false,
});

const ready = (sections: ProjectContextPack["sections"]): ProjectContextSnapshot => ({
  state: "ready",
  workspaceId: "w1",
  workspaceRoot: "/work",
  rulesEnabled: true,
  rules: [],
  memory: [],
  pack: pack(sections),
});

describe("composeSessionSystemContext", () => {
  it("sends nothing when there is no workspace to read rules from", () => {
    const snapshot: ProjectContextSnapshot = {
      state: "unconfigured",
      rules: [],
      memory: [],
      message: "AI: no workspace is configured",
    };
    expect(composeSessionSystemContext(snapshot)).toEqual({ text: "", tainted: false, sources: [] });
    expect(composeSessionSystemContext(undefined)).toEqual({ text: "", tainted: false, sources: [] });
  });

  // A bare "Project context" heading with nothing under it costs tokens and tells the model a set exists.
  it("sends nothing when the workspace has neither rules nor memories", () => {
    expect(composeSessionSystemContext(ready([]))).toEqual({ text: "", tainted: false, sources: [] });
  });

  it("renders the rules and memories the panel shows, and marks them untrusted content", () => {
    const composed = composeSessionSystemContext(
      ready([
        section("rules", "AGENTS.md", "Never touch the lockfile."),
        section("memory", "memory:m1", "SENTINEL-42"),
      ]),
    );
    expect(composed.text).toContain("Never touch the lockfile.");
    expect(composed.text).toContain("SENTINEL-42");
    expect(composed.text).toContain("AGENTS.md");
    // The pack's own verdict, not a guess: project prose is content the app did not author.
    expect(composed.tainted).toBe(true);
    // Itemised for the context panel, which the composed prose alone could never break back apart.
    expect(composed.sources).toEqual([
      { kind: "rules", trust: "project", characters: "Never touch the lockfile.".length },
      { kind: "memory", trust: "user", characters: "SENTINEL-42".length },
    ]);
  });
});
