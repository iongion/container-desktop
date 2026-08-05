import { describe, expect, it } from "vitest";
import { WORKSPACE_TOOL_NAMES } from "@/ai-system/core/workspaceToolNames";
import { workspaceToolSpecs } from "@/pi-agent-host/workspaceToolCatalogue";
import descriptions from "@/resources/prompts/workspace-tool-descriptions.md?raw";
import { parseMarkdownSections } from "@/template/markdownSections";

const REAL = parseMarkdownSections(descriptions);

describe("workspaceToolSpecs", () => {
  // The registered set and the app's own name union have to be the same set: the cards, the gating table and the
  // context report all key off these names, so a tool registered under any other name arrives unrecognised.
  it("registers exactly the app's workspace tool names, in the app's order", () => {
    expect(workspaceToolSpecs(REAL).map((spec) => spec.name)).toEqual([...WORKSPACE_TOOL_NAMES]);
  });

  it("takes every description from the resource, never from the name", () => {
    for (const spec of workspaceToolSpecs(REAL)) {
      expect(spec.description, spec.name).toBe(REAL[spec.name]?.trim());
      expect(spec.description.length, spec.name).toBeGreaterThan(20);
    }
  });

  // A blank description leaves the model guessing from the name alone — which is how a model reaches for `removePath`
  // to tidy up. Loud at startup beats silent in a turn.
  it("refuses to register a tool whose prose is missing", () => {
    const { readFile: _dropped, ...rest } = REAL;
    expect(() => workspaceToolSpecs(rest)).toThrow(/readFile has no description/);
  });

  it("asks for a path where a path is meant, and for the edit's three strings", () => {
    const byName = new Map(workspaceToolSpecs(REAL).map((spec) => [spec.name, spec.parameters]));
    expect(byName.get("readFile")).toMatchObject({ required: ["path"] });
    // The one optional path in the set: omitting it lists the root, which is where exploring starts.
    expect(byName.get("listDirectory")).not.toMatchObject({ required: ["path"] });
    expect(byName.get("editFile")).toMatchObject({ required: ["path", "oldString", "newString"] });
    expect(byName.get("execCommand")).toMatchObject({ required: ["program"] });
  });

  it("humanizes the label pi shows, without pretending it is translated", () => {
    const labels = new Map(workspaceToolSpecs(REAL).map((spec) => [spec.name, spec.label]));
    expect(labels.get("readFile")).toBe("Read file");
    expect(labels.get("findFiles")).toBe("Find files");
  });
});
