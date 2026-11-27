import { describe, expect, it } from "vitest";

import {
  findLifecycleHook,
  hookEnvironment,
  normalizeLifecycleHooks,
  removeLifecycleHook,
  splitCommandLine,
  upsertLifecycleHook,
} from "@/container-client/lifecycleHooks";

const web = { kind: "container" as const, connectionId: "system-default.podman", name: "web" };

describe("normalizeLifecycleHooks", () => {
  it("is empty for a missing or malformed value", () => {
    expect(normalizeLifecycleHooks(undefined)).toEqual({ hooks: [] });
    expect(normalizeLifecycleHooks("nope")).toEqual({ hooks: [] });
    expect(normalizeLifecycleHooks({ hooks: "nope" })).toEqual({ hooks: [] });
  });

  it("keeps well-formed hooks, trimmed, and drops ones without a target or any command", () => {
    const settings = normalizeLifecycleHooks({
      hooks: [
        { ...web, beforeStart: "  ./prep.sh  ", afterStop: "" },
        { kind: "stack", connectionId: "c", name: "shop", afterStop: "backup" },
        { kind: "volume", connectionId: "c", name: "x", beforeStart: "a" },
        { kind: "container", connectionId: "", name: "x", beforeStart: "a" },
        { kind: "container", connectionId: "c", name: " ", beforeStart: "a" },
        { kind: "container", connectionId: "c", name: "idle", beforeStart: " ", afterStop: "" },
        "garbage",
      ],
    });
    expect(settings.hooks).toEqual([
      { ...web, beforeStart: "./prep.sh" },
      { kind: "stack", connectionId: "c", name: "shop", afterStop: "backup" },
    ]);
  });

  it("keeps one hook per target, the last one written", () => {
    const settings = normalizeLifecycleHooks({
      hooks: [
        { ...web, beforeStart: "old" },
        { ...web, beforeStart: "new" },
      ],
    });
    expect(settings.hooks).toEqual([{ ...web, beforeStart: "new" }]);
  });
});

describe("find, upsert and remove", () => {
  it("finds a hook by kind, connection and name only", () => {
    const settings = normalizeLifecycleHooks({ hooks: [{ ...web, beforeStart: "a" }] });
    expect(findLifecycleHook(settings, web)?.beforeStart).toBe("a");
    expect(findLifecycleHook(settings, { ...web, kind: "stack" })).toBeUndefined();
    expect(findLifecycleHook(settings, { ...web, connectionId: "other" })).toBeUndefined();
  });

  it("replaces the hook for the same target and removes it by target", () => {
    let settings = upsertLifecycleHook({ hooks: [] }, { ...web, beforeStart: "a" });
    settings = upsertLifecycleHook(settings, { ...web, afterStop: "b" });
    expect(settings.hooks).toEqual([{ ...web, afterStop: "b" }]);
    expect(removeLifecycleHook(settings, web).hooks).toEqual([]);
  });

  it("drops a hook whose commands are both emptied", () => {
    const settings = upsertLifecycleHook({ hooks: [{ ...web, beforeStart: "a" }] }, { ...web, beforeStart: "  " });
    expect(settings.hooks).toEqual([]);
  });
});

describe("splitCommandLine", () => {
  it("splits on whitespace and keeps quoted arguments whole, without a shell", () => {
    expect(splitCommandLine("/usr/bin/env  FOO=1 ./run.sh")).toEqual(["/usr/bin/env", "FOO=1", "./run.sh"]);
    expect(splitCommandLine(`sh -c "pg_dumpall > ~/db.sql"`)).toEqual(["sh", "-c", "pg_dumpall > ~/db.sql"]);
    expect(splitCommandLine(`echo 'a "b" c' d`)).toEqual(["echo", 'a "b" c', "d"]);
    expect(splitCommandLine(`say "it\\"s" fine`)).toEqual(["say", 'it"s', "fine"]);
    expect(splitCommandLine(`run "" x`)).toEqual(["run", "", "x"]);
    expect(splitCommandLine("   ")).toEqual([]);
  });

  it("rejects an unterminated quote", () => {
    expect(() => splitCommandLine(`sh -c "oops`)).toThrow(/quote/);
  });
});

describe("hookEnvironment", () => {
  it("names the hook, the target and the connection; the stack only for stacks", () => {
    expect(
      hookEnvironment("beforeStart", {
        kind: "container",
        connectionId: "c",
        engine: "podman",
        name: "web",
        containerId: "abc",
      }),
    ).toEqual({
      CD_HOOK: "before-start",
      CD_CONNECTION: "c",
      CD_ENGINE: "podman",
      CD_CONTAINER_NAME: "web",
      CD_CONTAINER_ID: "abc",
    });
    expect(hookEnvironment("afterStop", { kind: "stack", connectionId: "c", engine: "podman", name: "shop" })).toEqual({
      CD_HOOK: "after-stop",
      CD_CONNECTION: "c",
      CD_ENGINE: "podman",
      CD_STACK: "shop",
    });
  });
});
