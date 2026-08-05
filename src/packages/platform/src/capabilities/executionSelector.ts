// ExecutionSelector (MAIN). Turns a session's execution target into the concrete backend it runs against. Both
// kinds are containers, so both are driven through the captured ConnectionExecHost and the exec-routed workspace —
// there is no local-filesystem arm to fall back to. Distinct targets are memoized so everything on one target
// shares a backend (and one sandbox lifecycle). A sandbox target lazily creates a disposable container; dispose
// (idempotent) removes it.

import { type ExecutionTarget, executionTargetKey, floorScopeFor } from "@/ai-system/core/executionTargets";
import type { ConnectionExecHost, ExecutionSelector, ResolvedExecution } from "@/ai-system/core/ports";
import type { EngineOps } from "@/ai-system/core/types";

import { createExecWorkspaceAccess, type TargetExec } from "./execWorkspaceAccess";

const SANDBOX_LABEL_KEY = "container-desktop.ai.sandbox";
const SANDBOX_ROOT = "/workspace";

export interface ExecutionSelectorOptions {
  // Identifies the run — labels the sandbox container and scopes container workspace roots so runs never collide.
  runId: string;
  // The app's own engine ops, re-scoped per target to the connection that target is reached through.
  engineOps?: EngineOps;
  connectionExec: ConnectionExecHost;
}

// A path unique to this run for an existing container's workspace root (a sandbox uses /workspace directly).
function containerWorkspaceRoot(runId: string): string {
  return `/tmp/container-desktop-ai/${runId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

// Wrap engineOps so a worker's container tools default to ITS connection; a model-supplied connectionId still wins.
function scopeEngineOps(base: EngineOps | undefined, connectionId: string): EngineOps | undefined {
  if (!base) return undefined;
  const scoped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(base as unknown as Record<string, unknown>)) {
    if (typeof value !== "function") {
      scoped[key] = value;
      continue;
    }
    const fn = value as (arg?: Record<string, unknown>) => unknown;
    scoped[key] = (arg?: Record<string, unknown>) => {
      if (key === "listConnections") return fn();
      const provided =
        arg && typeof arg.connectionId === "string" && arg.connectionId ? arg.connectionId : connectionId;
      return fn({ ...(arg ?? {}), connectionId: provided });
    };
  }
  return scoped as unknown as EngineOps;
}

export function createExecutionSelector(options: ExecutionSelectorOptions): ExecutionSelector {
  const { runId, connectionExec } = options;
  const cache = new Map<string, Promise<ResolvedExecution>>();

  async function build(target: ExecutionTarget): Promise<ResolvedExecution> {
    const floorScope = floorScopeFor(target);
    const connectionId = target.connectionId;

    if (target.kind === "container") {
      const containerId = target.containerId;
      const exec: TargetExec = (program, args, opts) =>
        connectionExec.execInContainer(connectionId, containerId, program, args, opts);
      const root = containerWorkspaceRoot(runId);
      const made = await exec("mkdir", ["-p", root]);
      if (made.code !== 0) {
        throw new Error(`Unable to prepare the container workspace ${root}: ${made.stderr || "mkdir failed"}`);
      }
      return {
        engineOps: scopeEngineOps(options.engineOps, connectionId),
        workspaceAccess: createExecWorkspaceAccess({ root, exec }),
        floorScope,
        dispose: async () => undefined,
      };
    }

    // sandbox: a fresh disposable container created now and removed at run end.
    const { containerId } = await connectionExec.createSandboxContainer(connectionId, target.image, {
      runId,
      label: `${SANDBOX_LABEL_KEY}=${runId}`,
    });
    // Pin every sandbox exec to /workspace so the model's execCommand (and any relative path) resolves there;
    // the workspace file ops use absolute paths regardless, so this is purely the cwd default.
    const exec: TargetExec = (program, args, opts) =>
      connectionExec.execInContainer(connectionId, containerId, program, args, { ...opts, workdir: SANDBOX_ROOT });
    let disposed = false;
    return {
      engineOps: scopeEngineOps(options.engineOps, connectionId),
      workspaceAccess: createExecWorkspaceAccess({ root: SANDBOX_ROOT, exec }),
      floorScope,
      dispose: async () => {
        if (disposed) return;
        disposed = true;
        await connectionExec.removeSandboxContainer(connectionId, containerId);
      },
    };
  }

  return {
    select(target) {
      const key = executionTargetKey(target);
      let existing = cache.get(key);
      if (!existing) {
        existing = build(target);
        cache.set(key, existing);
      }
      return existing;
    },

    // Every backend this selector built, torn down once. A build that FAILED has nothing to dispose and must not
    // stop the others: a run ends either way, and the sandbox is the one thing that must not survive it.
    async dispose() {
      const built = [...cache.values()];
      cache.clear();
      for (const pending of built) {
        await pending.then((resolved) => resolved.dispose()).catch(() => undefined);
      }
    },
  };
}
