// Runs the user's lifecycle hooks (see @/container-client/lifecycleHooks) on this computer, as the port the adapters
// call: the container hooks around every start and stop, the stack hooks around a stack's up, down, group actions and
// pod start/stop. A failed before-start hook refuses the start; a failed after-stop hook is only reported.

import {
  type ContainerLifecycleEvent,
  type ContainerLifecycleHooks,
  findLifecycleHook,
  HOOK_PHASE_LABEL,
  HOOK_TIMEOUT_MS,
  type HookEnvironmentTarget,
  type HookPhase,
  hookEnvironment,
  type LifecycleHook,
  type LifecycleHooksSettings,
  type StackHookTarget,
  splitCommandLine,
} from "@/container-client/lifecycleHooks";
import type { CommandExecutionResult } from "@/host-contract/exec";
import { errorMessage } from "@/utils";

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

interface FoundHook {
  hook: LifecycleHook;
  target: HookEnvironmentTarget;
}

export function createLifecycleHookRunner(deps: LifecycleHookRunnerDeps): ContainerLifecycleHooks {
  // Runs one phase of a hook; resolves to the failure message, or undefined when it succeeded or had no command.
  async function run(phase: HookPhase, found: FoundHook | undefined): Promise<string | undefined> {
    const command = found?.hook[phase];
    if (!found || !command) return undefined;
    const label = `The ${HOOK_PHASE_LABEL[phase]} hook of ${found.target.kind} ${found.target.name}`;
    let argv: string[];
    try {
      argv = splitCommandLine(command);
    } catch (error) {
      return `${label} is not a valid command: ${errorMessage(error)}`;
    }
    if (argv.length === 0) return undefined;
    const result = await deps.exec(argv[0], argv.slice(1), {
      env: hookEnvironment(phase, found.target),
      timeout: HOOK_TIMEOUT_MS,
    });
    if (result.success) return undefined;
    const detail = `${result.stderr ?? ""}`.trim().split(/\r?\n/).pop();
    return `${label} failed (exit ${result.code ?? "?"})${detail ? `: ${detail}` : ""}`;
  }

  // The container's hook, looked up by name only when its connection has any container hook at all.
  async function containerHook(event: ContainerLifecycleEvent): Promise<FoundHook | undefined> {
    const settings = await deps.loadSettings();
    const { connectionId } = event;
    if (!settings.hooks.some((hook) => hook.kind === "container" && hook.connectionId === connectionId)) {
      return undefined;
    }
    const name = await event.containerName();
    const hook = name ? findLifecycleHook(settings, { kind: "container", connectionId, name }) : undefined;
    return hook && name
      ? {
          hook,
          target: { kind: "container", connectionId, engine: event.engine, name, containerId: event.containerId },
        }
      : undefined;
  }

  async function stackHook(stack: StackHookTarget): Promise<FoundHook | undefined> {
    const hook = findLifecycleHook(await deps.loadSettings(), { ...stack, kind: "stack" });
    return hook ? { hook, target: { ...stack, kind: "stack" } } : undefined;
  }

  // Before-start: a failure throws, which refuses the start.
  async function refuse(lookup: Promise<FoundHook | undefined>): Promise<void> {
    const failure = await run("beforeStart", await lookup);
    if (failure) throw new Error(failure);
  }

  // After-stop: the target is already stopped, so a failure, or a failed lookup, is only reported.
  async function report(lookup: () => Promise<FoundHook | undefined>): Promise<void> {
    try {
      const failure = await run("afterStop", await lookup());
      if (failure) deps.warn(failure);
    } catch (error) {
      deps.warn(errorMessage(error));
    }
  }

  return {
    beforeStart: (event) => refuse(containerHook(event)),
    afterStop: (event) => report(() => containerHook(event)),
    stackBeforeStart: (stack) => refuse(stackHook(stack)),
    stackAfterStop: (stack) => report(() => stackHook(stack)),
  };
}
