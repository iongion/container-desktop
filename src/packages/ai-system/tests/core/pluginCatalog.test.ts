import { describe, expect, it } from "vitest";

import { buildPluginRows, parsePluginSource } from "@/ai-system/core/pluginCatalog";

describe("parsePluginSource", () => {
  it("parses an npm source with a version", () => {
    expect(parsePluginSource("npm:@foo/bar@1.2.3")).toEqual({
      kind: "npm",
      spec: "@foo/bar@1.2.3",
      name: "@foo/bar",
      version: "1.2.3",
    });
  });

  it("parses an npm source without a version", () => {
    expect(parsePluginSource("npm:@foo/bar")).toEqual({ kind: "npm", spec: "@foo/bar", name: "@foo/bar" });
  });

  it("parses a git source with a ref", () => {
    expect(parsePluginSource("git:github.com/user/repo@v1")).toEqual({
      kind: "git",
      spec: "github.com/user/repo@v1",
      name: "user/repo",
      version: "v1",
    });
  });

  it("parses an https git source and drops the .git suffix", () => {
    expect(parsePluginSource("https://github.com/user/repo.git")).toMatchObject({ kind: "git", name: "user/repo" });
  });

  it("parses an scp-style git source", () => {
    expect(parsePluginSource("git@github.com:user/repo@main")).toMatchObject({
      kind: "git",
      name: "user/repo",
      version: "main",
    });
  });

  it("treats an absolute path as a local source", () => {
    expect(parsePluginSource("/home/me/ext")).toMatchObject({ kind: "local", name: "ext" });
  });

  it("rejects empty and unprefixed junk with a reason", () => {
    expect(parsePluginSource("")).toEqual({ kind: "invalid", reason: "empty source" });
    expect(parsePluginSource("just-a-name")).toMatchObject({ kind: "invalid" });
  });

  it("rejects a source with a shell metacharacter", () => {
    // The source reaches an npm invocation inside the container. Refuse anything that could be argv trickery.
    expect(parsePluginSource("npm:foo;rm -rf /")).toMatchObject({ kind: "invalid" });
    expect(parsePluginSource("npm:foo$(id)")).toMatchObject({ kind: "invalid" });
    expect(parsePluginSource("npm:foo|tee x")).toMatchObject({ kind: "invalid" });
    expect(parsePluginSource("npm:foo\nbar")).toMatchObject({ kind: "invalid" });
  });

  it("rejects a source that would read as an npm flag", () => {
    expect(parsePluginSource("--registry=http://evil")).toMatchObject({ kind: "invalid" });
    expect(parsePluginSource("npm:-g")).toMatchObject({ kind: "invalid" });
  });

  it("rejects a prefix with nothing after it", () => {
    expect(parsePluginSource("npm:")).toMatchObject({ kind: "invalid" });
  });
});

describe("buildPluginRows", () => {
  const resources = {
    extensions: [{ path: "/pkgs/bar/index.ts", source: "npm:@foo/bar" }],
    commands: [{ name: "probe", source: "npm:@foo/bar" }],
    skills: [{ name: "search", source: "npm:@foo/bar" }],
    prompts: [{ name: "deploy", source: "npm:@foo/bar" }],
    builtins: [],
  };
  const noResources = { extensions: [], commands: [], skills: [], prompts: [], builtins: [] };

  it("builds a row per configured package with its contributions", () => {
    const rows = buildPluginRows({
      configured: [{ source: "npm:@foo/bar", scope: "user", filtered: false, installedPath: "/pkgs/bar" }],
      resources,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "@foo/bar",
      kind: "npm",
      scope: "user",
      enabled: true,
      installed: true,
      commands: ["probe"],
      skills: ["search"],
      prompts: ["deploy"],
    });
  });

  // Disable keeps the package configured and on disk with autoload off — pi contributes nothing from it,
  // and re-enabling costs no download. A package dropped from settings would vanish from this list entirely.
  it("marks a package configured with autoload off as disabled", () => {
    const rows = buildPluginRows({
      configured: [
        { source: "npm:@foo/bar", scope: "user", filtered: true, installedPath: "/pkgs/bar", autoload: false },
      ],
      resources: noResources,
    });
    expect(rows[0]).toMatchObject({ enabled: false, installed: true });
  });

  it("treats autoload true and autoload absent alike as enabled", () => {
    const rows = buildPluginRows({
      configured: [
        { source: "npm:@foo/a", scope: "user", filtered: true, autoload: true },
        { source: "npm:@foo/b", scope: "user", filtered: false },
      ],
      resources: noResources,
    });
    expect(rows.map((row) => row.enabled)).toEqual([true, true]);
  });

  it("marks a configured package with no installed path as not installed", () => {
    const rows = buildPluginRows({
      configured: [{ source: "npm:@foo/bar", scope: "user", filtered: false }],
      resources: noResources,
    });
    expect(rows[0]).toMatchObject({ installed: false, commands: [] });
  });

  it("keeps user and project entries of the same source as separate rows", () => {
    const rows = buildPluginRows({
      configured: [
        { source: "npm:@foo/bar", scope: "user", filtered: false },
        { source: "npm:@foo/bar", scope: "project", filtered: false },
      ],
      resources: noResources,
    });
    expect(rows.map((row) => row.scope)).toEqual(["user", "project"]);
  });

  it("attributes a contribution only to the package that declares it", () => {
    const rows = buildPluginRows({
      configured: [
        { source: "npm:@foo/bar", scope: "user", filtered: false, installedPath: "/pkgs/bar" },
        { source: "npm:@foo/bar-extra", scope: "user", filtered: false, installedPath: "/pkgs/bar-extra" },
      ],
      resources: {
        ...resources,
        skills: [
          { name: "search", source: "npm:@foo/bar" },
          { name: "other", source: "npm:@foo/bar-extra" },
        ],
      },
    });
    expect(rows[0].skills).toEqual(["search"]);
    expect(rows[1].skills).toEqual(["other"]);
  });

  it("ignores an unattributed contribution", () => {
    const rows = buildPluginRows({
      configured: [{ source: "npm:@foo/bar", scope: "user", filtered: false, installedPath: "/pkgs/bar" }],
      resources: { ...noResources, skills: [{ name: "local-skill" }] },
    });
    expect(rows[0].skills).toEqual([]);
  });

  it("keeps a row for a source it cannot classify rather than hiding it", () => {
    const rows = buildPluginRows({
      configured: [{ source: "just-a-name", scope: "user", filtered: false }],
      resources: noResources,
    });
    expect(rows[0]).toMatchObject({ name: "just-a-name", kind: "local" });
  });

  it("returns no rows when nothing is configured", () => {
    expect(buildPluginRows({ configured: [], resources: noResources })).toEqual([]);
  });
});
