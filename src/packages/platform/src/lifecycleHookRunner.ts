// Runs the user's lifecycle hooks (see @/container-client/lifecycleHooks) on this computer: the container hooks the
// containers adapter calls around every start and stop, and the stack hooks the Containers screen calls around a
// stack's group actions. A failed before-start hook refuses the start; a failed after-stop hook is only reported.

import {
  type ContainerLifecycleEvent,
  type ContainerLifecycleHooks,
  findLifecycleHook,
  HOOK_TIMEOUT_MS,
  type HookEnvironmentTarget,
  type HookPhase,
  hookEnvironment,
  type LifecycleHooksSettings,
  splitCommandLine,
} from "@/container-client/lifecycleHooks";
import type { CommandExecutionResult } from "@/host-contract/exec";

export type HookExec = (
  program: string,
  args: string[],
  opts: { env: Record<string, string>; timeout: number },
) => Promise<Pick<CommandExecutionResult, "success" | "code" | "stdout" | "stderr">>;

export interface LifecycleHookRunnerDeps {
  loadSettings: () => Promise<LifecycleHooksSettings>;
  exec: HookExec;
  // How an after-stop failure reaches the user.
  warn: (message: string) => void;
}

export interface StackHookTarget {
  connectionId: string;
  engine: string;
  name: string;
}

export interface LifecycleHookRunner extends ContainerLifecycleHooks {
  stackBeforeStart(stack: StackHookTarget): Promise<void>;
  stackAfterStop(stack: StackHookTarget): Promise<void>;
}

const PHASE_LABEL: Record<HookPhase, string> = { beforeStart: "before-start", afterStop: "after-stop" };

export function createLifecycleHookRunner(deps: LifecycleHookRunnerDeps): LifecycleHookRunner {
  // Runs one hook command; resolves to the failure message, or undefined when it succeeded or there was none.
  async function run(phase: HookPhase, target: HookEnvironmentTarget, command?: string): Promise<string | undefined> {
    if (!command) return undefined;
    const label = `The ${PHASE_LABEL[phase]} hook of ${target.kind} ${target.name}`;
    let argv: string[];
    try {
      argv = splitCommandLine(command);
    } catch (error) {
      return `${label} is not a valid command: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (argv.length === 0) return undefined;
    const result = await deps.exec(argv[0], argv.slice(1), {
      env: hookEnvironment(phase, target),
      timeout: HOOK_TIMEOUT_MS,
    });
    if (result.success) return undefined;
    const detail = `${result.stderr ?? ""}`.trim().split(/\r?\n/).pop();
    return `${label} failed (exit ${result.code ?? "?"})${detail ? `: ${detail}` : ""}`;
  }

  // The container's hook, looked up by name only when its connection has any container hook at all.
  async function containerHook(event: ContainerLifecycleEvent) {
    const settings = await deps.loadSettings();
    const candidates = settings.hooks.some(
      (hook) => hook.kind === "container" && hook.connectionId === event.connectionId,
    );
    if (!candidates) return undefined;
    const name = await event.containerName();
    if (!name) return undefined;
    const hook = findLifecycleHook(settings, { kind: "container", connectionId: event.connectionId, name });
    if (!hook) return undefined;
    const target: HookEnvironmentTarget = {
      kind: "container",
      connectionId: event.connectionId,
      engine: event.engine,
      name,
      containerId: event.containerId,
    };
    return { hook, target };
  }

  async function stackHook(stack: StackHookTarget) {
    const settings = await deps.loadSettings();
    const hook = findLifecycleHook(settings, { kind: "stack", connectionId: stack.connectionId, name: stack.name });
    return hook ? { hook, target: { ...stack, kind: "stack" as const } } : undefined;
  }

  return {
    async beforeStart(event) {
      const found = await containerHook(event);
      const failure = found ? await run("beforeStart", found.target, found.hook.beforeStart) : undefined;
      if (failure) throw new Error(failure);
    },
    async afterStop(event) {
      try {
        const found = await containerHook(event);
        const failure = found ? await run("afterStop", found.target, found.hook.afterStop) : undefined;
        if (failure) deps.warn(failure);
      } catch (error) {
        deps.warn(error instanceof Error ? error.message : String(error));
      }
    },
    async stackBeforeStart(stack) {
      const found = await stackHook(stack);
      const failure = found ? await run("beforeStart", found.target, found.hook.beforeStart) : undefined;
      if (failure) throw new Error(failure);
    },
    async stackAfterStop(stack) {
      try {
        const found = await stackHook(stack);
        const failure = found ? await run("afterStop", found.target, found.hook.afterStop) : undefined;
        if (failure) deps.warn(failure);
      } catch (error) {
        deps.warn(error instanceof Error ? error.message : String(error));
      }
    },
  };
}
