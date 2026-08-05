import { describe, expect, it } from "vitest";

import { collectResources } from "@/pi-agent-host/resources";

const fromPackage = (source: string) => ({ source, origin: "package" as const, scope: "user" as const });
const topLevel = { source: "local", origin: "top-level" as const, scope: "user" as const };

const loader = {
  getExtensions: () => ({
    extensions: [
      {
        path: "/pkgs/bar/src/index.ts",
        sourceInfo: fromPackage("npm:@foo/bar"),
        commands: new Map([["probe", { name: "probe", description: "Probe the host" }]]),
      },
      {
        path: "/home/agent/.pi/agent/extensions/local.ts",
        sourceInfo: topLevel,
        commands: new Map(),
      },
    ],
  }),
  getSkills: () => ({
    skills: [
      { name: "search", description: "Web search", sourceInfo: fromPackage("npm:@foo/bar") },
      { name: "notes", description: "Local notes", sourceInfo: topLevel },
    ],
  }),
  getPrompts: () => ({
    prompts: [{ name: "deploy", description: "Deploy", sourceInfo: fromPackage("npm:@foo/bar") }],
  }),
};

const emptyLoader = {
  getExtensions: () => ({ extensions: [] }),
  getSkills: () => ({ skills: [] }),
  getPrompts: () => ({ prompts: [] }),
};

describe("collectResources", () => {
  // pi labels every loaded resource with the package that brought it (SourceInfo.origin === "package"), so
  // attribution is exact rather than a path-prefix guess.
  it("attributes a resource declared by a package to that package", () => {
    const resources = collectResources(loader as never);
    expect(resources.skills).toContainEqual({ name: "search", description: "Web search", source: "npm:@foo/bar" });
    expect(resources.prompts).toContainEqual({ name: "deploy", description: "Deploy", source: "npm:@foo/bar" });
    expect(resources.extensions).toContainEqual({ path: "/pkgs/bar/src/index.ts", source: "npm:@foo/bar" });
  });

  it("leaves a top-level resource unattributed", () => {
    const resources = collectResources(loader as never);
    expect(resources.skills.find((skill) => skill.name === "notes")?.source).toBeUndefined();
    expect(resources.extensions.find((entry) => entry.path.includes("local.ts"))?.source).toBeUndefined();
  });

  it("collects an extension's commands and attributes them to its package", () => {
    const resources = collectResources(loader as never);
    expect(resources.commands).toEqual([{ name: "probe", description: "Probe the host", source: "npm:@foo/bar" }]);
  });

  it("does not attribute one package's resource to a package with a similar source", () => {
    const resources = collectResources({
      ...loader,
      getSkills: () => ({ skills: [{ name: "x", sourceInfo: fromPackage("npm:@foo/bar-extra") }] }),
    } as never);
    expect(resources.skills[0]).toMatchObject({ name: "x", source: "npm:@foo/bar-extra" });
  });

  it("prefers a command's own source over its extension's", () => {
    const resources = collectResources({
      ...emptyLoader,
      getExtensions: () => ({
        extensions: [
          {
            path: "/pkgs/bar/index.ts",
            sourceInfo: fromPackage("npm:@foo/bar"),
            commands: new Map([["inherited", { name: "inherited", sourceInfo: fromPackage("npm:@foo/other") }]]),
          },
        ],
      }),
    } as never);
    expect(resources.commands[0]).toMatchObject({ name: "inherited", source: "npm:@foo/other" });
  });

  it("tolerates an extension with no commands and a resource with no source info", () => {
    const resources = collectResources({
      ...emptyLoader,
      getExtensions: () => ({ extensions: [{ path: "/pkgs/bar/index.ts" }] }),
      getSkills: () => ({ skills: [{ name: "bare" }] }),
    } as never);
    expect(resources.commands).toEqual([]);
    expect(resources.extensions).toEqual([{ path: "/pkgs/bar/index.ts" }]);
    expect(resources.skills).toEqual([{ name: "bare" }]);
  });

  it("returns empty arrays when the loader has nothing — except pi's own commands, which always exist", () => {
    const resources = collectResources(emptyLoader as never);
    expect(resources).toMatchObject({ extensions: [], commands: [], skills: [], prompts: [] });
    // The palette showed only what plugins contributed, so everything a pi user already knows how to type looked
    // like it did not exist. pi's own list travels with the contributed one.
    expect(resources.builtins.map((builtin) => builtin.name)).toContain("compact");
    expect(resources.builtins.every((builtin) => builtin.description.length > 0)).toBe(true);
  });
});
