import { describe, expect, it } from "vitest";

import { parseSkillManifest } from "@/ai-system/adapters/skillManifest";

const validSkill = `---
name: inspect-project
description: Inspect project files safely
argument-hint: <area>
allowed-tools:
  - readFile
  - searchText
paths:
  - src/**
version: 1.2.0
---
# Inspect project

Inspect the requested area.
`;

describe("parseSkillManifest", () => {
  it("parses the supported bounded frontmatter and Markdown body", () => {
    expect(parseSkillManifest(validSkill, "inspect-project")).toEqual({
      diagnostics: [],
      skill: {
        name: "inspect-project",
        description: "Inspect project files safely",
        argumentHint: "<area>",
        allowedTools: ["readFile", "searchText"],
        paths: ["src/**"],
        version: "1.2.0",
        body: "# Inspect project\n\nInspect the requested area.\n",
      },
    });
  });

  it("accepts comma-separated tools and paths for Agent Skills compatibility", () => {
    const text = `---
name: inspect-project
description: Inspect project files safely
allowed-tools: readFile, searchText
paths: src/**, docs/**
---
Inspect it.
`;
    const result = parseSkillManifest(text, "inspect-project");
    expect(result.skill?.allowedTools).toEqual(["readFile", "searchText"]);
    expect(result.skill?.paths).toEqual(["src/**", "docs/**"]);
  });

  it.each([
    ["missing-frontmatter", "Inspect it.", "frontmatter-missing"],
    ["bad-yaml", "---\nname: [\n---\nInspect it.\n", "frontmatter-invalid"],
    ["name-mismatch", validSkill.replace("name: inspect-project", "name: other-project"), "name-mismatch"],
    [
      "authority field",
      "---\nname: inspect-project\ndescription: Inspect safely\nmodel: best\n---\nInspect it.\n",
      "field-unsupported",
    ],
    [
      "unknown tool",
      "---\nname: inspect-project\ndescription: Inspect safely\nallowed-tools: [readFile, rootShell]\n---\nInspect it.\n",
      "tool-unknown",
    ],
    [
      "unsafe path",
      "---\nname: inspect-project\ndescription: Inspect safely\npaths: ../secrets/**\n---\nInspect it.\n",
      "path-invalid",
    ],
    [
      "bidi display text",
      "---\nname: inspect-project\ndescription: Inspect ‮ safely\n---\nInspect it.\n",
      "text-unsafe",
    ],
    [
      "invalid UTF-8 replacement text",
      "---\nname: inspect-project\ndescription: Inspect safely\n---\nInspect \uFFFD it.\n",
      "encoding-invalid",
    ],
  ])("rejects %s", (_label, text, code) => {
    const result = parseSkillManifest(text, "inspect-project");
    expect(result.skill).toBeUndefined();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code }));
  });

  it("rejects an empty body and duplicate YAML keys", () => {
    const empty = parseSkillManifest("---\nname: empty\ndescription: Empty\n---\n", "empty");
    expect(empty.diagnostics).toContainEqual(expect.objectContaining({ code: "body-empty" }));

    const duplicate = parseSkillManifest(
      "---\nname: duplicate\nname: other\ndescription: Duplicate\n---\nBody\n",
      "duplicate",
    );
    expect(duplicate.diagnostics).toContainEqual(expect.objectContaining({ code: "frontmatter-invalid" }));
  });
});
