// ExecutionSelector (MAIN). Turns a worker's execution target into the concrete backend it runs against. The host
// keeps the fast local node:fs workspace; every other target is driven through the captured ConnectionExecHost and
// the exec-routed workspace. Distinct targets are memoized so N workers on one target share a backend (and one
// sandbox lifecycle). A sandbox target lazily creates a disposable container; dispose (idempotent) removes it.

import type { ConnectionExecHost, ExecutionSelector, ResolvedExecution } from "@/ai-system/core/ports";
import type { EngineOps } from "@/ai-system/core/types";
import { executionTargetKey, floorScopeFor, type WorkerExecutionTarget } from "@/ai-system/core/workers";
import type { IWorkspaceAccess } from "@/host-contract/workspaceAccess";

import { createExecWorkspaceAccess, type TargetExec } from "./execWorkspaceAccess";

const SANDBOX_LABEL_KEY = "container-desktop.ai.sandbox";
const SANDBOX_ROOT = "/workspace";

export interface ExecutionSelectorOptions {
  // Identifies the run — labels the sandbox container and scopes off-host workspace roots so runs never collide.
  runId: string;
  // The host defaults, reused verbatim for kind:"host".
  engineOps?: EngineOps;
  localWorkspace?: IWorkspaceAccess;
  connectionExec: ConnectionExecHost;
}

// A path unique to this run for a remote/existing-container workspace root (a sandbox uses /workspace directly).
function offHostRoot(runId: string): string {
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

  async function build(target: WorkerExecutionTarget): Promise<ResolvedExecution> {
    const floorScope = floorScopeFor(target);
    if (target.kind === "host") {
      return {
        engineOps: options.engineOps,
        workspaceAccess: options.localWorkspace,
        floorScope,
        dispose: async () => undefined,
      };
    }

    const connectionId = target.connectionId;

    if (target.kind === "remote") {
      const exec: TargetExec = (program, args, opts) =>
        connectionExec.execOnConnection(connectionId, program, args, opts);
      const root = offHostRoot(runId);
      const made = await connectionExec.execOnConnection(connectionId, "mkdir", ["-p", root]);
      if (made.code !== 0) {
        throw new Error(`Unable to prepare the remote workspace ${root}: ${made.stderr || "mkdir failed"}`);
      }
      return {
        engineOps: scopeEngineOps(options.engineOps, connectionId),
        workspaceAccess: createExecWorkspaceAccess({ root, exec }),
        floorScope,
        dispose: async () => undefined,
      };
    }

    if (target.kind === "container") {
      const containerId = target.containerId;
      const exec: TargetExec = (program, args, opts) =>
        connectionExec.execInContainer(connectionId, containerId, program, args, opts);
      const root = offHostRoot(runId);
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
  };
}
