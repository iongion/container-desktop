// Lifecycle hooks: a command the user sets to run on this computer before a container or a compose stack starts, or
// after it stops. Stored under `hooks` in user-settings.json and edited in Settings → Lifecycle hooks. A hook is a
// program and its arguments, never a shell string; anything missing or malformed in the file is dropped, so a
// hand-edited file can only lose hooks, never gain a half-formed one.
//
// The containers adapter calls the registered ContainerLifecycleHooks around start, stop and restart, so every path
// that changes a container's state (screens, tray, bulk actions, the MCP server) fires them. The app registers the
// runner at boot (@/platform/lifecycleHookRunner); with none registered nothing runs.

export const LIFECYCLE_HOOKS_SETTINGS_KEY = "hooks";
export const HOOK_TIMEOUT_MS = 60_000;

export type HookTargetKind = "container" | "stack";
export type HookPhase = "beforeStart" | "afterStop";

export interface HookTarget {
  kind: HookTargetKind;
  connectionId: string;
  // The container's name, or the compose project's.
  name: string;
}

export interface LifecycleHook extends HookTarget {
  beforeStart?: string;
  afterStop?: string;
}

export interface LifecycleHooksSettings {
  hooks: LifecycleHook[];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sameTarget(a: HookTarget, b: HookTarget): boolean {
  return a.kind === b.kind && a.connectionId === b.connectionId && a.name === b.name;
}

function normalizeHook(value: unknown): LifecycleHook | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const kind = raw.kind === "container" || raw.kind === "stack" ? raw.kind : undefined;
  const connectionId = text(raw.connectionId);
  const name = text(raw.name);
  const beforeStart = text(raw.beforeStart);
  const afterStop = text(raw.afterStop);
  if (!kind || !connectionId || !name || (!beforeStart && !afterStop)) {
    return undefined;
  }
  return {
    kind,
    connectionId,
    name,
    ...(beforeStart ? { beforeStart } : {}),
    ...(afterStop ? { afterStop } : {}),
  };
}

export function normalizeLifecycleHooks(value: unknown): LifecycleHooksSettings {
  const list = (value as { hooks?: unknown } | undefined)?.hooks;
  const hooks: LifecycleHook[] = [];
  for (const entry of Array.isArray(list) ? list : []) {
    const hook = normalizeHook(entry);
    if (!hook) continue;
    const existing = hooks.findIndex((other) => sameTarget(other, hook));
    if (existing >= 0) hooks.splice(existing, 1);
    hooks.push(hook);
  }
  return { hooks };
}

export function findLifecycleHook(settings: LifecycleHooksSettings, target: HookTarget): LifecycleHook | undefined {
  return settings.hooks.find((hook) => sameTarget(hook, target));
}

// Replaces the hook for the same target, in place; a hook with no command left is removed instead.
export function upsertLifecycleHook(settings: LifecycleHooksSettings, hook: LifecycleHook): LifecycleHooksSettings {
  const normalized = normalizeHook(hook);
  const index = settings.hooks.findIndex((other) => sameTarget(other, hook));
  const hooks = settings.hooks.slice();
  if (!normalized) {
    if (index >= 0) hooks.splice(index, 1);
  } else if (index >= 0) {
    hooks[index] = normalized;
  } else {
    hooks.push(normalized);
  }
  return { hooks };
}

export function removeLifecycleHook(settings: LifecycleHooksSettings, target: HookTarget): LifecycleHooksSettings {
  return { hooks: settings.hooks.filter((hook) => !sameTarget(hook, target)) };
}

// A command line into argv, the way a shell splits words but with nothing else of a shell: whitespace separates,
// single quotes keep everything literally, double quotes keep everything but a backslash-escaped `"` or `\`.
export function splitCommandLine(line: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let started = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote === "'") {
      if (char === "'") quote = undefined;
      else current += char;
    } else if (quote === '"') {
      if (char === "\\" && (line[index + 1] === '"' || line[index + 1] === "\\")) {
        current += line[index + 1];
        index += 1;
      } else if (char === '"') quote = undefined;
      else current += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) args.push(current);
      current = "";
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (quote) {
    throw new Error(`Unterminated ${quote} quote in: ${line}`);
  }
  if (started) args.push(current);
  return args;
}

export interface HookEnvironmentTarget extends HookTarget {
  engine: string;
  containerId?: string;
}

export function hookEnvironment(phase: HookPhase, target: HookEnvironmentTarget): Record<string, string> {
  const env: Record<string, string> = {
    CD_HOOK: phase === "beforeStart" ? "before-start" : "after-stop",
    CD_CONNECTION: target.connectionId,
    CD_ENGINE: target.engine,
  };
  if (target.kind === "stack") {
    env.CD_STACK = target.name;
  } else {
    env.CD_CONTAINER_NAME = target.name;
    if (target.containerId) env.CD_CONTAINER_ID = target.containerId;
  }
  return env;
}

// What the containers adapter reports around a state change. The name is looked up only when a hook might need it.
export interface ContainerLifecycleEvent {
  connectionId: string;
  engine: string;
  containerId: string;
  containerName: () => Promise<string | undefined>;
}

export interface ContainerLifecycleHooks {
  // Throws to refuse the start.
  beforeStart(event: ContainerLifecycleEvent): Promise<void>;
  // Never throws: the container is already stopped.
  afterStop(event: ContainerLifecycleEvent): Promise<void>;
}

let registered: ContainerLifecycleHooks | undefined;

export function setContainerLifecycleHooks(hooks: ContainerLifecycleHooks | undefined): void {
  registered = hooks;
}

export function getContainerLifecycleHooks(): ContainerLifecycleHooks | undefined {
  return registered;
}
