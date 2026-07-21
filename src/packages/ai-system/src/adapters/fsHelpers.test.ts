import { describe, expect, it, vi } from "vitest";

import type { IFileSystem, IPath } from "@/host-contract/fs";
import { readTextFileOrNull, writePrivateFileEnsuringDir, writePrivateFileViaTempRename } from "./fsHelpers";

function fakeFs(over: Partial<IFileSystem> = {}): IFileSystem {
  return {
    readTextFile: vi.fn(async () => "content"),
    writeTextFile: vi.fn(async () => {}),
    writePrivateTextFile: vi.fn(async () => {}),
    isFilePresent: vi.fn(async () => true),
    mkdir: vi.fn(async () => undefined),
    rename: vi.fn(async () => {}),
    ...over,
  };
}

const fakePath: IPath = {
  join: async (...p) => p.join("/"),
  basename: async (l) => l.slice(l.lastIndexOf("/") + 1),
  dirname: async (l) => l.slice(0, l.lastIndexOf("/")),
  resolve: async (...p) => p.join("/"),
};

describe("readTextFileOrNull", () => {
  it("returns null for a missing file, without reading it", async () => {
    const readTextFile = vi.fn(async () => "x");
    const fs = fakeFs({ isFilePresent: vi.fn(async () => false), readTextFile });
    expect(await readTextFileOrNull(fs, "/u/ai.json")).toBeNull();
    expect(readTextFile).not.toHaveBeenCalled();
  });

  it("returns the contents of a present file", async () => {
    const fs = fakeFs({ readTextFile: vi.fn(async () => "hello") });
    expect(await readTextFileOrNull(fs, "/u/ai.json")).toBe("hello");
  });

  it("propagates a read error on a present file (so callers fail closed)", async () => {
    const fs = fakeFs({
      readTextFile: vi.fn(async () => {
        throw new Error("EACCES");
      }),
    });
    await expect(readTextFileOrNull(fs, "/u/ai.json")).rejects.toThrow(/EACCES/);
  });
});

describe("writePrivateFileEnsuringDir", () => {
  it("creates the parent dir before writing privately (0600 on the Node impl)", async () => {
    const order: string[] = [];
    const fs = fakeFs({
      mkdir: vi.fn(async () => {
        order.push("mkdir");
        return undefined;
      }),
      writePrivateTextFile: vi.fn(async () => {
        order.push("write");
      }),
    });
    await writePrivateFileEnsuringDir(fs, fakePath, "/u/nested/ai.json", "{}");
    expect(fs.mkdir).toHaveBeenCalledWith("/u/nested", { recursive: true });
    expect(fs.writePrivateTextFile).toHaveBeenCalledWith("/u/nested/ai.json", "{}");
    expect(order).toEqual(["mkdir", "write"]);
  });
});

describe("writePrivateFileViaTempRename", () => {
  it("writes a distinct temp file then renames onto the target — for any extension", async () => {
    const writes: string[] = [];
    const renames: Array<[string, string]> = [];
    const fs = fakeFs({
      writePrivateTextFile: vi.fn(async (p: string) => {
        writes.push(p);
      }),
      rename: vi.fn(async (from: string, to: string) => {
        renames.push([from, to]);
      }),
    });
    // A path without a .json extension must still get a temp file distinct from the target,
    // or the write-then-rename collapses to a non-atomic in-place overwrite.
    await writePrivateFileViaTempRename(fs, fakePath, "/u/creds", "{}");
    expect(writes).toHaveLength(1);
    expect(writes[0]).not.toBe("/u/creds");
    expect(renames).toEqual([[writes[0], "/u/creds"]]);
  });
});
