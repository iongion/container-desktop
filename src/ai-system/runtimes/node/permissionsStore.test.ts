import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { commandKey } from "@/ai-system/core";
import { createPermissionsStore } from "./permissionsStore";

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cd-perms-"));
  file = join(dir, "nested", "ai-permissions.json");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("permissionsStore", () => {
  it("missing file → status 'missing' with an empty cache and the resolved path", async () => {
    const snap = await createPermissionsStore(file).load();
    expect(snap.status).toBe("missing");
    expect(snap.allowed).toEqual([]);
    expect(snap.blocked).toEqual([]);
    expect(snap.path).toBe(file);
    expect(snap.version).toBe("1.0.0");
  });

  it("corrupt/unreadable file → status 'error', empty cache (blocked NOT surfaced — fail closed)", async () => {
    await writeFile(file.replace(/nested\//, ""), "{not json", "utf8");
    const badFile = file.replace(/nested\//, "");
    const snap = await createPermissionsStore(badFile).load();
    expect(snap.status).toBe("error");
    expect(snap.allowed).toEqual([]);
    expect(snap.blocked).toEqual([]);
  });

  it("bad version → status 'error'", async () => {
    await writeFile(
      file.replace(/nested\//, ""),
      JSON.stringify({ version: "9.9.9", allowed: [], blocked: [] }),
      "utf8",
    );
    const snap = await createPermissionsStore(file.replace(/nested\//, "")).load();
    expect(snap.status).toBe("error");
  });

  it("addCommand persists and round-trips as status 'ok'", async () => {
    const store = createPermissionsStore(file);
    await store.addCommand("allowed", { program: "podman", args: ["stop", "web"] });
    const snap = await createPermissionsStore(file).load();
    expect(snap.status).toBe("ok");
    expect(snap.allowed).toHaveLength(1);
    expect(snap.allowed[0].program).toBe("podman");
    expect(snap.allowed[0].args).toEqual(["stop", "web"]);
  });

  it("addCommand dedupes by exact command key", async () => {
    const store = createPermissionsStore(file);
    await store.addCommand("allowed", { program: "podman", args: ["stop", "web"] });
    const snap = await store.addCommand("allowed", { program: "podman", args: ["stop", "web"] });
    expect(snap.allowed).toHaveLength(1);
  });

  it("adding to one list removes the same key from the other (allow/block are exclusive)", async () => {
    const store = createPermissionsStore(file);
    await store.addCommand("blocked", { program: "docker", args: ["system", "prune"] });
    const snap = await store.addCommand("allowed", { program: "docker", args: ["system", "prune"] });
    expect(snap.blocked).toHaveLength(0);
    expect(snap.allowed).toHaveLength(1);
  });

  it("removeCommand removes by key", async () => {
    const store = createPermissionsStore(file);
    await store.addCommand("allowed", { program: "podman", args: ["stop", "web"] });
    const snap = await store.removeCommand("allowed", commandKey("podman", ["stop", "web"]));
    expect(snap.allowed).toHaveLength(0);
  });

  it("setWebSearch persists the switch", async () => {
    const store = createPermissionsStore(file);
    await store.setWebSearch("allow");
    const snap = await createPermissionsStore(file).load();
    expect(snap.webSearch).toBe("allow");
  });
});
