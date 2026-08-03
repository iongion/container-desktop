import { describe, expect, it } from "vitest";

import { CONTAINER_TOOL_NAMES } from "@/ai-system/core/toolNames";
import { containerToolSpecs } from "@/pi-agent-host/containerToolCatalogue";

// Every tool needs one, so the fixture answers for all of them; the individual lookups are asserted below.
const descriptions = Object.fromEntries(CONTAINER_TOOL_NAMES.map((name) => [name, `does ${name}`]));

describe("containerToolSpecs", () => {
  // The app owns the names: its cards, presentations and gating table all key off CONTAINER_TOOL_NAMES. A tool
  // registered here under a name the app does not know would render as a generic JSON card and gate as unknown.
  it("covers exactly the container tools the app knows, in that order", () => {
    expect(containerToolSpecs(descriptions).map((spec) => spec.name)).toEqual([...CONTAINER_TOOL_NAMES]);
  });

  it("takes each description from the prompt resource", () => {
    const spec = containerToolSpecs(descriptions).find((entry) => entry.name === "listContainers");
    expect(spec?.description).toBe("does listContainers");
  });

  it("refuses to register a tool the prompt resource does not describe", () => {
    const { listImages: _dropped, ...missingOne } = descriptions;
    expect(() => containerToolSpecs(missingOne)).toThrow(/listImages/);
  });

  it("gives every tool a non-empty label for pi's own surfaces", () => {
    for (const spec of containerToolSpecs(descriptions)) expect(spec.label.length).toBeGreaterThan(0);
  });

  describe("parameter schemas", () => {
    const byName = (name: string) => {
      const spec = containerToolSpecs(descriptions).find((entry) => entry.name === name);
      if (!spec) throw new Error(`no spec for ${name}`);
      return spec.parameters as { properties?: Record<string, unknown>; required?: string[] };
    };

    it("asks for nothing at all on listConnections, which is global", () => {
      expect(byName("listConnections").properties ?? {}).toEqual({});
    });

    it("makes the connection optional on a list, so the session's own is used by default", () => {
      const schema = byName("listContainers");
      expect(Object.keys(schema.properties ?? {})).toEqual(["connectionId"]);
      expect(schema.required ?? []).toEqual([]);
    });

    it("requires the entity id on an inspect and a lifecycle action", () => {
      for (const name of ["inspectContainer", "startContainer", "removeVolume"]) {
        expect(byName(name).required).toEqual(["id"]);
      }
    });

    it("requires a reference rather than an id on pullImage", () => {
      const schema = byName("pullImage");
      expect(schema.required).toEqual(["reference"]);
      expect(Object.keys(schema.properties ?? {})).toContain("reference");
    });

    it("offers tail and since on getContainerLogs without requiring them", () => {
      const schema = byName("getContainerLogs");
      expect(schema.required).toEqual(["id"]);
      expect(Object.keys(schema.properties ?? {})).toEqual(["id", "tail", "since", "connectionId"]);
    });

    // pi validates arguments against these and serializes them to the model as JSON Schema, so they have to be
    // plain JSON Schema objects — which is what TypeBox 1.x emits, with no symbol brand to lose across copies.
    it("emits plain JSON Schema objects", () => {
      for (const spec of containerToolSpecs(descriptions)) {
        expect((spec.parameters as { type?: string }).type).toBe("object");
        expect(Object.getOwnPropertySymbols(spec.parameters)).toEqual([]);
        expect(JSON.parse(JSON.stringify(spec.parameters))).toEqual(spec.parameters);
      }
    });
  });
});
