import { describe, expect, it } from "vitest";

import { createToolArtifactFileStore } from "@/ai-system/adapters/toolArtifactFileStore";
import { createToolArtifactRecord, TOOL_ARTIFACT_FILE_VERSION } from "@/ai-system/core/toolArtifacts";
import type { IFileSystem, IPath } from "@/host-contract/fs";

const FILE = "/data/ai-tool-artifacts.json";
const TEMP = `${FILE}.tmp`;

const path: IPath = {
  join: async (...parts) => parts.join("/"),
  basename: async (location) => location.slice(location.lastIndexOf("/") + 1),
  dirname: async (location) => location.slice(0, location.lastIndexOf("/")),
  resolve: async (...parts) => parts.join("/"),
};

function memoryFs() {
  const files = new Map<string, string>();
  const privateWrites: string[] = [];
  const fs: IFileSystem = {
    readTextFile: async (location) => {
      const content = files.get(location);
      if (content === undefined) throw new Error("ENOENT");
      return content;
    },
    writeTextFile: async () => undefined,
    writePrivateTextFile: async (location, contents) => {
      privateWrites.push(location);
      files.set(location, contents);
    },
    isFilePresent: async (location) => files.has(location),
    mkdir: async () => undefined,
    rename: async (from, to) => {
      const content = files.get(String(from));
      if (content === undefined) throw new Error("ENOENT");
      files.set(String(to), content);
      files.delete(String(from));
    },
  };
  return { fs, files, privateWrites };
}

describe("toolArtifactFileStore", () => {
  it("reports a missing store and persists artifacts through a private atomic replacement", async () => {
    const memory = memoryFs();
    const store = createToolArtifactFileStore(FILE, memory.fs, path);

    await expect(store.load()).resolves.toEqual({ status: "missing", records: [], path: FILE });
    await store.save([
      createToolArtifactRecord({
        id: "artifact-1",
        threadId: "thread-1",
        createdAt: 1,
        content: '{"ok":true}',
        fingerprint: "a".repeat(64),
      }),
    ]);

    expect(memory.privateWrites).toEqual([TEMP]);
    expect(memory.files.has(TEMP)).toBe(false);
    expect(JSON.parse(memory.files.get(FILE) ?? "")).toMatchObject({
      version: TOOL_ARTIFACT_FILE_VERSION,
      records: [{ id: "artifact-1", threadId: "thread-1" }],
    });
  });
});
