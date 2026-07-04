// Neutral test for the shell-neutral AI-permissions store: an in-memory IFileSystem + IPath exercise the core
// logic (missing / corrupt / fail-closed, plus the allow/reject mutations) with no node:fs — the same store runs
// over platform/electron/host FS on Electron and window.FS on Tauri.

import { describe, expect, it, vi } from "vitest";

import { commandKey } from "@/ai-system/core";
import type { IFileSystem, IPath } from "@/platform/contract";
import { createPermissionsStore } from "./permissionsStoreCore";

// A shared-map fake so multiple store instances round-trip the same persisted file, like real disk.
function memFs(seed: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(seed));
  const fs: IFileSystem = {
    readTextFile: async (p) => {
      const v = files.get(p);
      if (v === undefined) {
        throw new Error("ENOENT");
      }
      return v;
    },
    writeTextFile: async (p, c) => {
      files.set(p, c);
    },
    writePrivateTextFile: async (p, c) => {
      files.set(p, c);
    },
    isFilePresent: async (p) => files.has(p),
    mkdir: async () => undefined,
    rename: async () => {},
  };
  return { fs, files };
}

const path: IPath = {
  join: async (...p) => p.join("/"),
  basename: async (l) => l.slice(l.lastIndexOf("/") + 1),
  dirname: async (l) => l.slice(0, l.lastIndexOf("/")),
  resolve: async (...p) => p.join("/"),
};

const FILE = "/u/nested/ai-permissions.json";

describe("permissionsStoreCore", () => {
  it("missing file → status 'missing' with an empty cache and the resolved path", async () => {
    const snap = await createPermissionsStore(FILE, memFs().fs, path).load();
    expect(snap.status).toBe("missing");
    expect(snap.allowed).toEqual([]);
    expect(snap.blocked).toEqual([]);
    expect(snap.path).toBe(FILE);
    expect(snap.version).toBe("1.0.0");
  });

  it("corrupt JSON → status 'error', empty cache", async () => {
    const snap = await createPermissionsStore(FILE, memFs({ [FILE]: "{not json" }).fs, path).load();
    expect(snap.status).toBe("error");
    expect(snap.allowed).toEqual([]);
    expect(snap.blocked).toEqual([]);
  });

  it("present-but-unreadable file → status 'error' (fail closed, blocked NOT surfaced)", async () => {
    const { fs } = memFs({ [FILE]: "{}" });
    fs.readTextFile = vi.fn(async () => {
      throw new Error("EACCES");
    });
    const snap = await createPermissionsStore(FILE, fs, path).load();
    expect(snap.status).toBe("error");
  });

  it("bad version → status 'error'", async () => {
    const seeded = JSON.stringify({ version: "9.9.9", allowed: [], blocked: [] });
    const snap = await createPermissionsStore(FILE, memFs({ [FILE]: seeded }).fs, path).load();
    expect(snap.status).toBe("error");
  });

  it("addCommand persists and round-trips as status 'ok'", async () => {
    const { fs } = memFs();
    await createPermissionsStore(FILE, fs, path).addCommand("allowed", { program: "podman", args: ["stop", "web"] });
    const snap = await createPermissionsStore(FILE, fs, path).load();
    expect(snap.status).toBe("ok");
    expect(snap.allowed).toHaveLength(1);
    expect(snap.allowed[0].program).toBe("podman");
    expect(snap.allowed[0].args).toEqual(["stop", "web"]);
  });

  it("addCommand dedupes by exact command key", async () => {
    const store = createPermissionsStore(FILE, memFs().fs, path);
    await store.addCommand("allowed", { program: "podman", args: ["stop", "web"] });
    const snap = await store.addCommand("allowed", { program: "podman", args: ["stop", "web"] });
    expect(snap.allowed).toHaveLength(1);
  });

  it("adding to one list removes the same key from the other (allow/block are exclusive)", async () => {
    const store = createPermissionsStore(FILE, memFs().fs, path);
    await store.addCommand("blocked", { program: "docker", args: ["system", "prune"] });
    const snap = await store.addCommand("allowed", { program: "docker", args: ["system", "prune"] });
    expect(snap.blocked).toHaveLength(0);
    expect(snap.allowed).toHaveLength(1);
  });

  it("removeCommand removes by key", async () => {
    const store = createPermissionsStore(FILE, memFs().fs, path);
    await store.addCommand("allowed", { program: "podman", args: ["stop", "web"] });
    const snap = await store.removeCommand("allowed", commandKey("podman", ["stop", "web"]));
    expect(snap.allowed).toHaveLength(0);
  });

  it("setWebSearch persists the switch", async () => {
    const { fs } = memFs();
    await createPermissionsStore(FILE, fs, path).setWebSearch("allow");
    const snap = await createPermissionsStore(FILE, fs, path).load();
    expect(snap.webSearch).toBe("allow");
  });
});
