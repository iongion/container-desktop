import { describe, expect, it, vi } from "vitest";

import { createProjectContextFileStore } from "@/ai-system/adapters/projectContextFileStore";
import type { ProjectContextWorkspaceRecord } from "@/ai-system/core/projectContext";
import type { IFileSystem, IPath } from "@/host-contract/fs";

const FILE = "/private/project-context.json";
const TEMP = `${FILE}.tmp`;

function record(): ProjectContextWorkspaceRecord {
  return {
    workspaceId: "a".repeat(64),
    workspaceRoot: "/workspace",
    rulesEnabled: true,
    memory: [
      {
        id: "memory-1",
        content: "Prefer focused tests.",
        source: "user",
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  };
}

function memoryFs(seed: Record<string, string> = {}) {
  const files = new Map(Object.entries(seed));
  const privateWrites: string[] = [];
  const fs = {
    readTextFile: vi.fn(async (path: string) => {
      const value = files.get(path);
      if (value === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return value;
    }),
    writePrivateTextFile: vi.fn(async (path: string, contents: string) => {
      privateWrites.push(path);
      files.set(path, contents);
    }),
    rename: vi.fn(async (from: string, to: string) => {
      const value = files.get(from);
      if (value === undefined) throw new Error("missing temporary file");
      files.set(to, value);
      files.delete(from);
    }),
    isFilePresent: vi.fn(async (path: string) => files.has(path)),
    mkdir: vi.fn(async () => undefined),
  } as unknown as IFileSystem;
  const path = {
    dirname: vi.fn(async () => "/private"),
    basename: vi.fn(async () => "project-context.json"),
    join: vi.fn(async (...parts: string[]) => parts.join("/")),
  } as unknown as IPath;
  return { fs, path, files, privateWrites };
}

describe("project context file store", () => {
  it("distinguishes missing from unreadable records", async () => {
    const missing = memoryFs();
    expect(await createProjectContextFileStore(FILE, missing.fs, missing.path).load()).toEqual({
      status: "missing",
      workspaces: [],
      path: FILE,
    });

    const invalid = memoryFs({ [FILE]: "{broken" });
    expect(await createProjectContextFileStore(FILE, invalid.fs, invalid.path).load()).toEqual({
      status: "error",
      workspaces: [],
      path: FILE,
    });
  });

  it("writes privately through an atomic temporary rename", async () => {
    const memory = memoryFs();
    const store = createProjectContextFileStore(FILE, memory.fs, memory.path);

    await store.save([record()]);

    expect(memory.privateWrites).toEqual([TEMP]);
    expect(memory.files.has(TEMP)).toBe(false);
    expect(await store.load()).toMatchObject({ status: "ok", workspaces: [record()] });
  });
});
