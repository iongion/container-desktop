import { describe, expect, it } from "vitest";

import { archivePathFor, rotateArchives } from "@/platform/electron/log/rotation";

// A tiny in-memory fs stand-in covering the calls rotateArchives makes.
function makeFakeFs(present: string[]) {
  const files = new Set(present);
  return {
    files,
    existsSync: (p: string) => files.has(p),
    rmSync: (p: string) => {
      files.delete(p);
    },
    renameSync: (from: string, to: string) => {
      files.delete(from);
      files.add(to);
    },
  } as any;
}

const LOG = "/data/logs/container-desktop.log";

describe("rotation", () => {
  it("names rotated siblings next to the active file", () => {
    expect(archivePathFor(LOG, 1)).toBe("/data/logs/container-desktop.1.log");
    expect(archivePathFor(LOG, 3)).toBe("/data/logs/container-desktop.3.log");
  });

  it("shifts archives and keeps at most maxFiles, dropping the oldest", () => {
    // active + 3 archives, keep 3 → oldest (.3) dropped, others shift up, active → .1
    const fs = makeFakeFs([LOG, archivePathFor(LOG, 1), archivePathFor(LOG, 2), archivePathFor(LOG, 3)]);
    rotateArchives(LOG, 3, fs);
    expect(fs.files.has(LOG)).toBe(false); // active moved to .1
    expect(fs.files.has(archivePathFor(LOG, 1))).toBe(true);
    expect(fs.files.has(archivePathFor(LOG, 2))).toBe(true);
    expect(fs.files.has(archivePathFor(LOG, 3))).toBe(true);
    // total kept files == maxFiles (no .4 ever created)
    expect(fs.files.has(archivePathFor(LOG, 4))).toBe(false);
    expect(fs.files.size).toBe(3);
  });

  it("never throws on a broken fs (best-effort)", () => {
    const brokenFs = {
      existsSync: () => true,
      rmSync: () => {
        throw new Error("nope");
      },
      renameSync: () => {
        throw new Error("nope");
      },
    } as any;
    expect(() => rotateArchives(LOG, 3, brokenFs)).not.toThrow();
  });
});
