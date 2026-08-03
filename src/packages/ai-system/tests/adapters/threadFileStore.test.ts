import { describe, expect, it, vi } from "vitest";
import { createThreadFileStore } from "@/ai-system/adapters/threadFileStore";
import { createEmptyThreadRecord, THREAD_RECORD_VERSION } from "@/ai-system/core/threads";
import type { IFileSystem, IPath } from "@/host-contract/fs";

const FILE = "/data/ai-threads.json";
const TEMP = "/data/ai-threads.json.tmp";
const LEGACY_FILE = "/data/ai-conversations.json";

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
  const value = createEmptyThreadRecord({ id, title: id, now: updatedAt });
  value.updatedAt = updatedAt;
  return value;
}

describe("threadFileStore", () => {
  it("reports a missing file and reads a valid versioned file", async () => {
    expect(await createThreadFileStore(FILE, createMemoryFs().fs, path).load()).toEqual({
      status: "missing",
      records: [],
      path: FILE,
    });

    const existing = record("thread-1", 4);
    const seeded = createMemoryFs({
      [FILE]: JSON.stringify({ version: THREAD_RECORD_VERSION, records: [existing] }),
    });
    expect(await createThreadFileStore(FILE, seeded.fs, path).load()).toEqual({
      status: "ok",
      records: [existing],
      path: FILE,
    });
  });

  it("falls back to the legacy file while keeping the new path as the write target", async () => {
    const seeded = createMemoryFs({
      [LEGACY_FILE]: JSON.stringify({
        version: 1,
        records: [
          {
            version: 1,
            id: "thread-1",
            title: "Existing chat",
            createdAt: 1,
            updatedAt: 1,
            view: { sessionId: "thread-1", phase: "idle", lastSeq: 0, timeline: [] },
            modelHistory: [],
          },
        ],
      }),
    });
    const store = createThreadFileStore(FILE, seeded.fs, path, LEGACY_FILE);

    expect(await store.load()).toMatchObject({ status: "ok", records: [{ id: "thread-1" }], path: FILE });
    await store.save([record("thread-1", 2)]);
    expect(seeded.files.has(FILE)).toBe(true);
    expect(seeded.files.has(LEGACY_FILE)).toBe(true);
  });

  it("writes privately to a temporary file before atomically replacing the durable file", async () => {
    const memory = createMemoryFs({ [FILE]: "old readable data" });
    const store = createThreadFileStore(FILE, memory.fs, path);

    await store.save([record("thread-1", 1)]);

    expect(memory.writes).toEqual([TEMP]);
    expect(memory.files.has(TEMP)).toBe(false);
    expect(JSON.parse(memory.files.get(FILE) ?? "")).toMatchObject({
      version: THREAD_RECORD_VERSION,
      records: [{ id: "thread-1" }],
    });
  });

  it("preserves the previous readable file when the atomic replace fails", async () => {
    const memory = createMemoryFs({ [FILE]: "previous" });
    memory.fs.rename = vi.fn(async () => {
      throw new Error("rename failed");
    });

    await expect(createThreadFileStore(FILE, memory.fs, path).save([record("thread-1", 1)])).rejects.toThrow(
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
    const store = createThreadFileStore(FILE, memory.fs, path);

    const first = store.save([record("old", 1)]);
    const second = store.save([record("new", 2)]);
    releaseFirst();
    await Promise.all([first, second]);

    expect(JSON.parse(memory.files.get(FILE) ?? "").records).toEqual([expect.objectContaining({ id: "new" })]);
  });
});
