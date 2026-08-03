import { describe, expect, it, vi } from "vitest";

import { createSkillTrustFileStore } from "@/ai-system/adapters/skillTrustFileStore";
import type { SkillTrustSnapshot } from "@/ai-system/core/skillTrust";
import type { IFileSystem, IPath } from "@/host-contract/fs";

const path: IPath = {
  join: async (...parts) => parts.join("/"),
  basename: async (location) => location.slice(location.lastIndexOf("/") + 1),
  dirname: async (location) => location.slice(0, location.lastIndexOf("/")),
  resolve: async (...parts) => parts.join("/"),
};

function fsFake(contents?: string): IFileSystem {
  return {
    readTextFile: vi.fn(async () => contents ?? ""),
    writeTextFile: vi.fn(async () => {}),
    writePrivateTextFile: vi.fn(async () => {}),
    isFilePresent: vi.fn(async () => contents !== undefined),
    mkdir: vi.fn(async () => undefined),
    rename: vi.fn(async () => {}),
  };
}

describe("createSkillTrustFileStore", () => {
  it("distinguishes a missing file from a corrupt one", async () => {
    expect(await createSkillTrustFileStore("/data/trust.json", fsFake(), path).load()).toMatchObject({
      status: "missing",
      path: "/data/trust.json",
    });
    expect(await createSkillTrustFileStore("/data/trust.json", fsFake("bad"), path).load()).toMatchObject({
      status: "error",
      path: "/data/trust.json",
    });
  });

  it("writes privately through a sibling temp file and atomic rename", async () => {
    const fs = fsFake();
    const snapshot: SkillTrustSnapshot = { status: "ok", path: "/data/trust.json", sources: [], skills: [] };
    await createSkillTrustFileStore(snapshot.path, fs, path).save(snapshot);
    expect(fs.writePrivateTextFile).toHaveBeenCalledWith(
      "/data/trust.json.tmp",
      expect.stringContaining('"version": 1'),
    );
    expect(fs.rename).toHaveBeenCalledWith("/data/trust.json.tmp", "/data/trust.json");
  });
});
