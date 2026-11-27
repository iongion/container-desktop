import { describe, expect, it } from "vitest";
import { parseMarkdownSections } from "@/mcp-server/core/markdownSections";
import { buildMcpTools, GATED_CONTAINER_TOOLS, shippedMcpTools } from "@/mcp-server/core/toolCatalogue";
import { CONTAINER_TOOL_NAMES } from "@/mcp-server/core/toolNames";
import descriptionsSource from "@/resources/prompts/mcp-tool-descriptions.md?raw";

// Every tool needs one, so the fixture answers for all of them; the individual lookups are asserted below.
const descriptions = Object.fromEntries(CONTAINER_TOOL_NAMES.map((name) => [name, `does ${name}`]));

function tool(name: string) {
  const found = buildMcpTools(descriptions).find((entry) => entry.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
}

function schemaOf(name: string) {
  return tool(name).inputSchema as {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

const READS = [
  "listConnections",
  "listContainers",
  "inspectContainer",
  "getContainerLogs",
  "getContainerStats",
  "listImages",
  "inspectImage",
  "listNetworks",
  "inspectNetwork",
  "listVolumes",
  "inspectVolume",
];
const REMOVALS = ["removeContainer", "removeImage", "removeNetwork", "removeVolume"];

describe("buildMcpTools", () => {
  it("serves exactly the container tools, in their declared order", () => {
    expect(buildMcpTools(descriptions).map((entry) => entry.name)).toEqual([...CONTAINER_TOOL_NAMES]);
  });

  it("takes each description from the descriptions resource", () => {
    expect(tool("listContainers").description).toBe("does listContainers");
  });

  it("refuses to build a tool the resource does not describe", () => {
    const { listImages: _dropped, ...missingOne } = descriptions;
    expect(() => buildMcpTools(missingOne)).toThrow(/listImages/);
  });

  it("refuses a blank description", () => {
    expect(() => buildMcpTools({ ...descriptions, removeVolume: "  \n" })).toThrow(/removeVolume/);
  });

  it("gives every tool a readable title", () => {
    expect(tool("listContainers").title).toBe("List containers");
    expect(tool("getContainerLogs").title).toBe("Get container logs");
  });
});

describe("the shipped descriptions", () => {
  it("describe exactly the served tools, so no section goes stale", () => {
    const sections = Object.keys(parseMarkdownSections(descriptionsSource)).sort();
    expect(sections).toEqual([...CONTAINER_TOOL_NAMES].sort());
  });

  it("give every served tool a non-empty description from the resource", () => {
    const sections = parseMarkdownSections(descriptionsSource);
    const tools = shippedMcpTools();
    expect(tools.map((entry) => entry.name)).toEqual([...CONTAINER_TOOL_NAMES]);
    for (const entry of tools) {
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.description).toBe(sections[entry.name]);
    }
  });
});

describe("input schemas", () => {
  it("accepts only an empty object on listConnections, which is global", () => {
    expect(schemaOf("listConnections")).toEqual({ type: "object", properties: {}, additionalProperties: false });
  });

  it("makes the connection optional on a list, so the current connection is used by default", () => {
    const schema = schemaOf("listContainers");
    expect(Object.keys(schema.properties ?? {})).toEqual(["connectionId"]);
    expect(schema.required ?? []).toEqual([]);
  });

  it("requires a non-empty entity id on an inspect, a lifecycle action and a removal", () => {
    for (const name of ["inspectContainer", "startContainer", "removeVolume"]) {
      expect(schemaOf(name).required).toEqual(["id"]);
      expect(schemaOf(name).properties?.id).toMatchObject({ type: "string", minLength: 1 });
    }
  });

  it("requires a reference rather than an id on pullImage", () => {
    const schema = schemaOf("pullImage");
    expect(schema.required).toEqual(["reference"]);
    expect(schema.properties?.reference).toMatchObject({ type: "string", minLength: 1 });
  });

  it("offers tail and since on getContainerLogs, with tail capped at 5000 lines", () => {
    const schema = schemaOf("getContainerLogs");
    expect(schema.required).toEqual(["id"]);
    expect(Object.keys(schema.properties ?? {})).toEqual(["id", "tail", "since", "connectionId"]);
    expect(schema.properties?.tail).toEqual({ type: "integer", minimum: 1, maximum: 5000 });
  });

  // An undeclared argument never reaches the engine: a client cannot slip a `force` or a filter past the schema.
  it("closes every schema to undeclared arguments", () => {
    for (const name of CONTAINER_TOOL_NAMES) expect(schemaOf(name).additionalProperties).toBe(false);
  });

  // inputSchema travels as JSON, so it has to be plain JSON Schema, which is what TypeBox 1.x emits.
  it("emits plain JSON Schema objects", () => {
    for (const entry of buildMcpTools(descriptions)) {
      expect((entry.inputSchema as { type?: string }).type).toBe("object");
      expect(Object.getOwnPropertySymbols(entry.inputSchema)).toEqual([]);
      expect(JSON.parse(JSON.stringify(entry.inputSchema))).toEqual(entry.inputSchema);
    }
  });
});

describe("annotations", () => {
  it("marks the reads read-only", () => {
    for (const name of READS) expect(tool(name).annotations.readOnlyHint).toBe(true);
  });

  it("gates exactly the tools that change an engine", () => {
    expect([...GATED_CONTAINER_TOOLS].sort()).toEqual(
      [
        "startContainer",
        "stopContainer",
        "restartContainer",
        "pauseContainer",
        "unpauseContainer",
        ...REMOVALS,
        "pullImage",
      ].sort(),
    );
    for (const name of GATED_CONTAINER_TOOLS) expect(tool(name).annotations.readOnlyHint).toBe(false);
  });

  it("marks the removals destructive and no other change", () => {
    for (const name of GATED_CONTAINER_TOOLS) {
      expect(tool(name).annotations.destructiveHint).toBe(REMOVALS.includes(name));
    }
  });

  it("marks a change idempotent unless repeating it does something again", () => {
    for (const name of GATED_CONTAINER_TOOLS) {
      const repeatsWork = name === "restartContainer" || name === "pullImage";
      expect(tool(name).annotations.idempotentHint).toBe(!repeatsWork);
    }
  });

  it("marks only pullImage as reaching beyond the local engines", () => {
    for (const name of CONTAINER_TOOL_NAMES) {
      expect(tool(name).annotations.openWorldHint).toBe(name === "pullImage");
    }
  });
});
