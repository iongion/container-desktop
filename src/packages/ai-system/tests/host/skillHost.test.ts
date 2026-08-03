import { describe, expect, it, vi } from "vitest";

import type { SkillTrustSnapshot, SkillTrustStore } from "@/ai-system/core/skillTrust";
import { createSkillHost } from "@/ai-system/host/skillHost";
import type { FileSystemStat, IFileDiscoverySystem, IPath } from "@/host-contract/fs";

const skillText = (name: string, body: string) => `---
name: ${name}
description: ${name} description
allowed-tools: [readFile, writeFile]
---
${body}
`;

interface Entry {
  kind: FileSystemStat["kind"];
  text?: string;
  modifiedMs?: number;
  realPath?: string;
}

function fakeFs(seed: Record<string, Entry>) {
  const entries = new Map(Object.entries(seed));
  const fs: IFileDiscoverySystem = {
    readTextFile: async (location) => {
      const entry = entries.get(location);
      if (entry?.kind !== "file" || entry.text === undefined) throw new Error("ENOENT");
      return entry.text;
    },
    writeTextFile: async (location, contents) => {
      entries.set(location, { kind: "file", text: contents, modifiedMs: Date.now() });
    },
    writePrivateTextFile: async (location, contents) => {
      entries.set(location, { kind: "file", text: contents, modifiedMs: Date.now() });
    },
    isFilePresent: async (location) => entries.has(location),
    mkdir: async (location) => {
      entries.set(location, { kind: "directory" });
      return location;
    },
    rename: async (from, to) => {
      const entry = entries.get(String(from));
      if (!entry) throw new Error("ENOENT");
      entries.set(String(to), entry);
      entries.delete(String(from));
    },
    listDirectory: async (location) => {
      const current = entries.get(location);
      if (current?.kind !== "directory") throw new Error("ENOENT");
      const prefix = `${location}/`;
      return [...entries]
        .filter(([entryPath]) => entryPath.startsWith(prefix) && !entryPath.slice(prefix.length).includes("/"))
        .map(([entryPath, entry]) => ({ name: entryPath.slice(prefix.length), kind: entry.kind }));
    },
    lstat: async (location) => {
      const entry = entries.get(location);
      if (!entry) throw new Error("ENOENT");
      return {
        kind: entry.kind,
        size: new TextEncoder().encode(entry.text ?? "").byteLength,
        modifiedMs: entry.modifiedMs ?? 1,
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

function trustStore(): SkillTrustStore & { current: SkillTrustSnapshot } {
  const store = {
    current: { status: "missing", path: "/data/trust.json", sources: [], skills: [] } as SkillTrustSnapshot,
    async load() {
      return structuredClone(store.current);
    },
    async save(snapshot: SkillTrustSnapshot) {
      store.current = { ...structuredClone(snapshot), status: "ok" };
    },
  };
  return store;
}

function fixture(
  watchOptions: Pick<Parameters<typeof createSkillHost>[0], "watchIntervalMs" | "watchDebounceMs"> = {},
) {
  let workspaceRoot: string | undefined = "/workspace";
  const files = fakeFs({
    "/data": { kind: "directory" },
    "/data/ai-skills": { kind: "directory" },
    "/data/ai-skills/user-task": { kind: "directory" },
    "/data/ai-skills/user-task/SKILL.md": { kind: "file", text: skillText("user-task", "User body") },
    "/workspace": { kind: "directory" },
    "/workspace/.container-desktop": { kind: "directory" },
    "/workspace/.container-desktop/skills": { kind: "directory" },
    "/workspace/.container-desktop/skills/project-task": { kind: "directory" },
    "/workspace/.container-desktop/skills/project-task/SKILL.md": {
      kind: "file",
      text: skillText("project-task", "Project body"),
    },
  });
  const trust = trustStore();
  const host = createSkillHost({
    userRoot: "/data/ai-skills",
    getWorkspaceRoot: async () => workspaceRoot,
    trustStore: trust,
    path,
    watch: false,
    ...watchOptions,
    ...files,
  });
  return { host, trust, setWorkspaceRoot: (root: string | undefined) => (workspaceRoot = root), ...files };
}

describe("skillHost", () => {
  it("publishes user skills while project skills require source enablement and exact trust", async () => {
    const { host } = fixture();
    await host.ready();
    const initial = host.snapshot();
    expect(initial.revision).toBe("1");
    expect(initial.user).toEqual({ root: "/data/ai-skills", status: "ok" });
    expect(initial.skills).toEqual([
      expect.objectContaining({ id: "skill:project:project-task", enabled: false, trusted: false }),
      expect.objectContaining({ id: "skill:user:user-task", enabled: true, trusted: true }),
    ]);

    await host.setProjectSourceEnabled(true);
    let project = host.snapshot().skills.find((skill) => skill.source.kind === "project")!;
    expect(project).toMatchObject({ enabled: true, trusted: false });
    await host.setProjectSkillTrust(project.id, project.fingerprint, true);
    project = host.snapshot().skills.find((skill) => skill.source.kind === "project")!;
    expect(project.trusted).toBe(true);
  });

  it("revokes project trust when content changes", async () => {
    const { host, entries } = fixture();
    await host.ready();
    await host.setProjectSourceEnabled(true);
    const before = host.snapshot().skills.find((skill) => skill.source.kind === "project")!;
    await host.setProjectSkillTrust(before.id, before.fingerprint, true);
    const file = entries.get("/workspace/.container-desktop/skills/project-task/SKILL.md")!;
    file.text = skillText("project-task", "Changed body");
    file.modifiedMs = 2;
    await host.reload();
    const after = host.snapshot().skills.find((skill) => skill.source.kind === "project")!;
    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(after.trusted).toBe(false);
  });

  it("revalidates bytes and trust at invocation and marks project content tainted", async () => {
    const { host } = fixture();
    await host.ready();
    await host.setProjectSourceEnabled(true);
    const project = host.snapshot().skills.find((skill) => skill.source.kind === "project")!;
    await host.setProjectSkillTrust(project.id, project.fingerprint, true);
    await expect(
      host.resolveInvocation({ skillId: project.id, expectedFingerprint: "0".repeat(64), arguments: "target" }),
    ).rejects.toThrow(/changed/i);
    await expect(
      host.resolveInvocation({ skillId: project.id, expectedFingerprint: project.fingerprint, arguments: "target" }),
    ).resolves.toMatchObject({ arguments: "target", initialTaint: true, manifest: { body: "Project body\n" } });
  });

  it("rejects a project skill when the configured workspace changes before invocation", async () => {
    const { host, setWorkspaceRoot } = fixture();
    await host.ready();
    await host.setProjectSourceEnabled(true);
    const project = host.snapshot().skills.find((skill) => skill.source.kind === "project")!;
    await host.setProjectSkillTrust(project.id, project.fingerprint, true);

    setWorkspaceRoot(undefined);

    await expect(
      host.resolveInvocation({ skillId: project.id, expectedFingerprint: project.fingerprint, arguments: "target" }),
    ).rejects.toThrow(/workspace changed/i);
  });

  it("debounces source changes into one live snapshot update", async () => {
    const { host, entries } = fixture({ watchIntervalMs: 5, watchDebounceMs: 5 });
    await host.ready();
    await host.startWatching();
    const before = host.snapshot().skills.find((skill) => skill.id === "skill:user:user-task")?.fingerprint;
    const listener = vi.fn();
    const updated = new Promise<void>((resolve) => {
      host.subscribe((snapshot) => {
        listener(snapshot);
        resolve();
      });
    });
    const file = entries.get("/data/ai-skills/user-task/SKILL.md")!;
    file.text = skillText("user-task", "Changed user body");
    file.modifiedMs = 2;

    await Promise.race([
      updated,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("watch timeout")), 500)),
    ]);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(host.snapshot().skills.find((skill) => skill.id === "skill:user:user-task")?.fingerprint).not.toBe(before);
    host.dispose();
  });
});
