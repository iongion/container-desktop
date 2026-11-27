import { describe, expect, it } from "vitest";

import type { LifecycleHooksSettings } from "@/container-client/lifecycleHooks";
import { createLifecycleHookRunner, type HookExec } from "@/platform/lifecycleHookRunner";

const PODMAN = "system-default.podman";

function harness(settings: LifecycleHooksSettings, exit = 0) {
  const calls: { program: string; args: string[]; env: Record<string, string>; timeout: number }[] = [];
  const warnings: string[] = [];
  let names = 0;
  const exec: HookExec = async (program, args, opts) => {
    calls.push({ program, args, env: opts.env, timeout: opts.timeout });
    return { success: exit === 0, code: exit, stdout: "", stderr: exit ? "boom" : "" };
  };
  const runner = createLifecycleHookRunner({
    loadSettings: async () => settings,
    exec,
    warn: (message) => warnings.push(message),
  });
  const event = (containerId = "abc") => ({
    connectionId: PODMAN,
    engine: "podman",
    containerId,
    containerName: async () => {
      names += 1;
      return "web";
    },
  });
  return { runner, calls, warnings, event, nameLookups: () => names };
}

const hooks = (entries: LifecycleHooksSettings["hooks"]): LifecycleHooksSettings => ({ hooks: entries });

describe("container hooks", () => {
  it("runs the before-start command with the container's environment and the time limit", async () => {
    const h = harness(
      hooks([{ kind: "container", connectionId: PODMAN, name: "web", beforeStart: `./prep.sh "a b"` }]),
    );
    await h.runner.beforeStart(h.event());
    expect(h.calls).toEqual([
      {
        program: "./prep.sh",
        args: ["a b"],
        env: {
          CD_HOOK: "before-start",
          CD_CONNECTION: PODMAN,
          CD_ENGINE: "podman",
          CD_CONTAINER_NAME: "web",
          CD_CONTAINER_ID: "abc",
        },
        timeout: 60000,
      },
    ]);
  });

  it("refuses the start when the before-start hook fails", async () => {
    const h = harness(hooks([{ kind: "container", connectionId: PODMAN, name: "web", beforeStart: "false" }]), 1);
    await expect(h.runner.beforeStart(h.event())).rejects.toThrow(/before-start hook.*web.*exit 1/i);
  });

  it("only warns when the after-stop hook fails", async () => {
    const h = harness(hooks([{ kind: "container", connectionId: PODMAN, name: "web", afterStop: "false" }]), 2);
    await expect(h.runner.afterStop(h.event())).resolves.toBeUndefined();
    expect(h.warnings[0]).toMatch(/after-stop hook.*web.*exit 2/i);
  });

  it("does not even look the container up when its connection has no container hooks", async () => {
    const h = harness(hooks([{ kind: "stack", connectionId: PODMAN, name: "web", beforeStart: "x" }]));
    await h.runner.beforeStart(h.event());
    await h.runner.afterStop(h.event());
    expect(h.nameLookups()).toBe(0);
    expect(h.calls).toEqual([]);
  });

  it("runs nothing for a container without a hook, or a hook without that command", async () => {
    const h = harness(hooks([{ kind: "container", connectionId: PODMAN, name: "web", afterStop: "x" }]));
    await h.runner.beforeStart(h.event());
    expect(h.calls).toEqual([]);
  });
});

describe("stack hooks", () => {
  it("runs once for the stack, with CD_STACK", async () => {
    const h = harness(hooks([{ kind: "stack", connectionId: PODMAN, name: "shop", afterStop: "backup --all" }]));
    await h.runner.stackAfterStop({ connectionId: PODMAN, engine: "podman", name: "shop" });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({ program: "backup", args: ["--all"], env: { CD_STACK: "shop" } });
  });

  it("refuses the stack start when its before-start hook fails", async () => {
    const h = harness(hooks([{ kind: "stack", connectionId: PODMAN, name: "shop", beforeStart: "false" }]), 1);
    await expect(h.runner.stackBeforeStart({ connectionId: PODMAN, engine: "podman", name: "shop" })).rejects.toThrow(
      /shop/,
    );
  });
});
