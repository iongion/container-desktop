import { describe, expect, it } from "vitest";

import { discoverSkillSource } from "@/ai-system/adapters/skillDiscovery";
import type { FileSystemDirEntry, FileSystemStat, IFileDiscoverySystem, IPath } from "@/host-contract/fs";

const skillText = (name: string, body = "Do the work.\n") => `---
name: ${name}
description: ${name} description
allowed-tools: readFile
---
${body}`;

function fakeFiles(seed: Record<string, { kind: FileSystemStat["kind"]; text?: string; realPath?: string }>) {
  const entries = new Map(Object.entries(seed));
  const fs: IFileDiscoverySystem = {
    readTextFile: async (location) => {
      const entry = entries.get(location);
      if (entry?.kind !== "file" || entry.text === undefined) throw new Error("ENOENT");
      return entry.text;
    },
    writeTextFile: async () => {},
    writePrivateTextFile: async () => {},
    isFilePresent: async (location) => entries.has(location),
    mkdir: async () => undefined,
    rename: async () => {},
    listDirectory: async (location) => {
      const prefix = `${location}/`;
      const children = new Map<string, FileSystemDirEntry>();
      for (const [path, entry] of entries) {
        if (!path.startsWith(prefix)) continue;
        const remainder = path.slice(prefix.length);
        if (!remainder || remainder.includes("/")) continue;
        children.set(remainder, { name: remainder, kind: entry.kind });
      }
      return [...children.values()];
    },
    lstat: async (location) => {
      const entry = entries.get(location);
      if (!entry) throw new Error("ENOENT");
      return {
        kind: entry.kind,
        size: new TextEncoder().encode(entry.text ?? "").byteLength,
        modifiedMs: 1,
      };
    },
    realPath: async (location) => entries.get(location)?.realPath ?? location,
    isPathWithin: async (root, location) => {
      const resolved = entries.get(location)?.realPath ?? location;
      return resolved === root || resolved.startsWith(`${root}/`);
    },
  };
  return { fs, entries };
}

const path: IPath = {
  join: async (...parts) => parts.join("/"),
  basename: async (location) => location.slice(location.lastIndexOf("/") + 1),
  dirname: async (location) => location.slice(0, location.lastIndexOf("/")),
  resolve: async (...parts) => parts.join("/"),
};

function validTree(body?: string) {
  return fakeFiles({
    "/skills": { kind: "directory" },
    "/skills/inspect-project": { kind: "directory" },
    "/skills/inspect-project/SKILL.md": { kind: "file", text: skillText("inspect-project", body) },
  });
}

describe("discoverSkillSource", () => {
  it("returns renderer-safe descriptors and keeps prompt bodies host-side", async () => {
    const snapshot = await discoverSkillSource({ source: { kind: "user" }, root: "/skills", path, ...validTree() });
    expect(snapshot.status).toBe("ok");
    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.skills).toHaveLength(1);
    expect(snapshot.skills[0]).toMatchObject({
      id: "skill:user:inspect-project",
      command: "/skill:user:inspect-project",
      shortCommand: "/skill:inspect-project",
      name: "inspect-project",
      source: { kind: "user" },
      allowedTools: ["readFile"],
    });
    expect(snapshot.skills[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(snapshot.skills[0]).not.toHaveProperty("body");
    expect(snapshot.records[0]?.manifest.body).toBe("Do the work.\n");
  });

  it("fingerprints exact Markdown bytes", async () => {
    const first = await discoverSkillSource({ source: { kind: "user" }, root: "/skills", path, ...validTree("One\n") });
    const second = await discoverSkillSource({
      source: { kind: "user" },
      root: "/skills",
      path,
      ...validTree("Two\n"),
    });
    expect(first.skills[0]?.fingerprint).not.toBe(second.skills[0]?.fingerprint);
  });

  it("changes the fingerprint when frontmatter bytes change without changing their meaning", async () => {
    const first = validTree();
    const second = validTree();
    second.entries.get("/skills/inspect-project/SKILL.md")!.text = skillText("inspect-project").replace(
      "description: inspect-project description",
      'description: "inspect-project description"',
    );

    const firstSnapshot = await discoverSkillSource({ source: { kind: "user" }, root: "/skills", path, ...first });
    const secondSnapshot = await discoverSkillSource({
      source: { kind: "user" },
      root: "/skills",
      path,
      ...second,
    });

    expect(firstSnapshot.skills[0]?.description).toBe(secondSnapshot.skills[0]?.description);
    expect(firstSnapshot.skills[0]?.fingerprint).not.toBe(secondSnapshot.skills[0]?.fingerprint);
  });

  it("isolates invalid entries instead of dropping valid siblings", async () => {
    const tree = fakeFiles({
      "/skills": { kind: "directory" },
      "/skills/good": { kind: "directory" },
      "/skills/good/SKILL.md": { kind: "file", text: skillText("good") },
      "/skills/bad": { kind: "directory" },
      "/skills/bad/SKILL.md": { kind: "file", text: "not frontmatter" },
    });
    const snapshot = await discoverSkillSource({ source: { kind: "user" }, root: "/skills", path, ...tree });
    expect(snapshot.skills.map((skill) => skill.name)).toEqual(["good"]);
    expect(snapshot.diagnostics).toContainEqual(expect.objectContaining({ entry: "bad", code: "frontmatter-missing" }));
  });

  it.each([
    ["skill directory symlink", "/skills/escaped", "directory-symlink"],
    ["SKILL.md symlink", "/skills/escaped/SKILL.md", "file-symlink"],
  ])("rejects a %s", async (_label, symlinkPath, code) => {
    const seed: Record<string, { kind: FileSystemStat["kind"]; text?: string }> = {
      "/skills": { kind: "directory" },
      "/skills/escaped": { kind: "directory" },
      "/skills/escaped/SKILL.md": { kind: "file", text: skillText("escaped") },
    };
    seed[symlinkPath] = { kind: "symlink", text: seed[symlinkPath]?.text };
    const snapshot = await discoverSkillSource({
      source: { kind: "user" },
      root: "/skills",
      path,
      ...fakeFiles(seed),
    });
    expect(snapshot.skills).toEqual([]);
    expect(snapshot.diagnostics).toContainEqual(expect.objectContaining({ entry: "escaped", code }));
  });

  it("rejects a canonical path outside its source root", async () => {
    const tree = validTree();
    tree.entries.get("/skills/inspect-project/SKILL.md")!.realPath = "/outside/secret";
    const snapshot = await discoverSkillSource({ source: { kind: "user" }, root: "/skills", path, ...tree });
    expect(snapshot.skills).toEqual([]);
    expect(snapshot.diagnostics).toContainEqual(expect.objectContaining({ code: "path-escape" }));
  });
});
