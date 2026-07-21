import { describe, expect, it, vi } from "vitest";

import { CONVERSATION_RECORD_VERSION, createEmptyConversationRecord } from "@/ai-system/core/conversations";
import type { IFileSystem, IPath } from "@/host-contract/fs";
import { createConversationFileStore } from "./conversationFileStore";

const FILE = "/data/ai-conversations.json";
const TEMP = "/data/ai-conversations.json.tmp";

function createMemoryFs(seed: Record<string, string> = {}) {
  const files = new Map(Object.entries(seed));
  const writes: string[] = [];
  const fs: IFileSystem = {
    readTextFile: async (location) => {
      const value = files.get(location);
      if (value === undefined) throw new Error("ENOENT");
      return value;
    },
    writeTextFile: async (location, contents) => {
      files.set(location, contents);
    },
    writePrivateTextFile: async (location, contents) => {
      writes.push(location);
      files.set(location, contents);
    },
    isFilePresent: async (location) => files.has(location),
    mkdir: async () => undefined,
    rename: async (from, to) => {
      const value = files.get(String(from));
      if (value === undefined) throw new Error("ENOENT");
      files.set(String(to), value);
      files.delete(String(from));
    },
  };
  return { fs, files, writes };
}

const path: IPath = {
  join: async (...parts) => parts.join("/"),
  basename: async (location) => location.slice(location.lastIndexOf("/") + 1),
  dirname: async (location) => location.slice(0, location.lastIndexOf("/")),
  resolve: async (...parts) => parts.join("/"),
};

function record(id: string, updatedAt: number) {
  const value = createEmptyConversationRecord({ id, title: id, now: updatedAt });
  value.updatedAt = updatedAt;
  return value;
}

describe("conversationFileStore", () => {
  it("reports a missing file and reads a valid versioned file", async () => {
    expect(await createConversationFileStore(FILE, createMemoryFs().fs, path).load()).toEqual({
      status: "missing",
      records: [],
      path: FILE,
    });

    const existing = record("chat-1", 4);
    const seeded = createMemoryFs({
      [FILE]: JSON.stringify({ version: CONVERSATION_RECORD_VERSION, records: [existing] }),
    });
    expect(await createConversationFileStore(FILE, seeded.fs, path).load()).toEqual({
      status: "ok",
      records: [existing],
      path: FILE,
    });
  });

  it("writes privately to a temporary file before atomically replacing the durable file", async () => {
    const memory = createMemoryFs({ [FILE]: "old readable data" });
    const store = createConversationFileStore(FILE, memory.fs, path);

    await store.save([record("chat-1", 1)]);

    expect(memory.writes).toEqual([TEMP]);
    expect(memory.files.has(TEMP)).toBe(false);
    expect(JSON.parse(memory.files.get(FILE) ?? "")).toMatchObject({
      version: CONVERSATION_RECORD_VERSION,
      records: [{ id: "chat-1" }],
    });
  });

  it("preserves the previous readable file when the atomic replace fails", async () => {
    const memory = createMemoryFs({ [FILE]: "previous" });
    memory.fs.rename = vi.fn(async () => {
      throw new Error("rename failed");
    });

    await expect(createConversationFileStore(FILE, memory.fs, path).save([record("chat-1", 1)])).rejects.toThrow(
      "rename failed",
    );
    expect(memory.files.get(FILE)).toBe("previous");
  });

  it("serializes concurrent writes so the newest requested snapshot wins", async () => {
    const memory = createMemoryFs();
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let writeCount = 0;
    const originalWrite = memory.fs.writePrivateTextFile;
    memory.fs.writePrivateTextFile = async (location, contents) => {
      writeCount += 1;
      if (writeCount === 1) await firstBlocked;
      await originalWrite(location, contents);
    };
    const store = createConversationFileStore(FILE, memory.fs, path);

    const first = store.save([record("old", 1)]);
    const second = store.save([record("new", 2)]);
    releaseFirst();
    await Promise.all([first, second]);

    expect(JSON.parse(memory.files.get(FILE) ?? "").records).toEqual([expect.objectContaining({ id: "new" })]);
  });
});
