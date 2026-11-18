import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FS, Path, Platform } from "@/__tests__/setup/nodeTestHost";

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("nodeTestHost", () => {
  it("round-trips a text file and reports presence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "cd-node-host-"));
    roots.push(root);
    const file = await Path.join(root, "a.txt");
    expect(await FS.isFilePresent(file)).toBe(false);
    await FS.writeTextFile(file, "hello");
    expect(await FS.isFilePresent(file)).toBe(true);
    expect(await FS.readTextFile(file)).toBe("hello");
  });

  it("reads env, honors an explicit user-data dir, and reports no SSH hosts", async () => {
    process.env.CONTAINER_DESKTOP_USER_DATA_DIR = "/tmp/cd-user-data";
    expect(await Platform.getUserDataPath()).toBe("/tmp/cd-user-data");
    delete process.env.CONTAINER_DESKTOP_USER_DATA_DIR;
    expect(await Platform.getSSHConfig()).toEqual([]);
    await expect(Platform.launchTerminal("podman", ["ps"])).rejects.toThrow(/not available/i);
  });
});
