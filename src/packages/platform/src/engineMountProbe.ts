// Mount probing — "is this container's mount actually reachable, and what backs it?". Reads the cached
// container list for its targets and asks each connection's own host to stat the source path.

import { isMockMode } from "@/container-client/mock/mode";
import type { MountProbeRequest, MountProbeResponse, MountProbeResult } from "@/container-client/resourceSyncProtocol";
import { mountProbeKey } from "@/container-client/resourceSyncProtocol";
import type { HostClientFacade } from "@/container-client/runtimes/facade";
import type { CommandExecutionResult } from "@/host-contract/exec";
import {
  type EngineProbeView,
  firstOutputLine,
  settleWithin,
  singleQuotePosix,
  sleep,
} from "@/platform/engineProbeSupport";

const MOUNT_PROBE_TIMEOUT_MS = 5000;
const MOCK_MOUNT_PROBE_DELAY_MS = 2200;

interface RawMountEntry {
  Type?: string;
  Name?: string;
  Source?: string;
  Destination?: string;
  Target?: string;
}

interface MountProbeTarget {
  connectionId: string;
  containerId: string;
  type: string;
  source: string;
  destination: string;
  path: string;
}

function buildMountProbeScript(path: string): string {
  const quotedPath = singleQuotePosix(path);
  return [
    `p=${quotedPath}`,
    `if [ ! -e "$p" ]; then printf '%s\\n' "missing" >&2; exit 2; fi`,
    `backend=""`,
    `if command -v stat >/dev/null 2>&1; then backend=$(stat -f -c %T "$p" 2>/dev/null || stat -f %T "$p" 2>/dev/null || true); fi`,
    `printf '%s\\n' "\${backend:-path}"`,
  ].join("; ");
}

export async function probeMounts(view: EngineProbeView, request: MountProbeRequest = {}): Promise<MountProbeResponse> {
  const targets = collectMountProbeTargets(view, request.connectionId);
  if (isMockMode()) {
    await sleep(MOCK_MOUNT_PROBE_DELAY_MS);
    return {
      results: targets.map((target) => ({
        ...mountProbeIdentity(target),
        backend: target.type === "volume" ? "local volume" : "host bind",
        latencyMs: 8,
        healthy: true,
      })),
    };
  }
  const results = await Promise.all(targets.map((target) => probeMountTarget(view, target)));
  return { results };
}

function collectMountProbeTargets(view: EngineProbeView, connectionId?: string): MountProbeTarget[] {
  const targets: MountProbeTarget[] = [];
  for (const [id, state] of view.resources.entries()) {
    if (connectionId && id !== connectionId) {
      continue;
    }
    for (const container of state.containers ?? []) {
      const mounts: RawMountEntry[] = Array.isArray(container.Mounts) ? container.Mounts : [];
      for (const raw of mounts) {
        const type = `${raw?.Type ?? ""}`;
        const destination = `${raw?.Destination ?? raw?.Target ?? ""}`;
        const source = type === "volume" ? `${raw?.Name ?? ""}` : `${raw?.Source ?? raw?.Name ?? ""}`;
        const path = `${raw?.Source ?? (type === "volume" ? "" : source)}`;
        targets.push({
          connectionId: id,
          containerId: `${container.Id ?? ""}`,
          type,
          source,
          destination,
          path,
        });
      }
    }
  }
  return targets;
}

function mountProbeIdentity(target: MountProbeTarget): MountProbeResult {
  const identity = {
    connectionId: target.connectionId,
    containerId: target.containerId,
    source: target.source,
    destination: target.destination,
  };
  return {
    ...identity,
    key: mountProbeKey(identity),
    latencyMs: 0,
    healthy: false,
  };
}

async function probeMountTarget(view: EngineProbeView, target: MountProbeTarget): Promise<MountProbeResult> {
  const base = mountProbeIdentity(target);
  const host = view.hosts.get(target.connectionId);
  if (!host) {
    return { ...base, error: "Connection is not ready" };
  }
  if (!target.path) {
    return { ...base, error: "No source path reported by the engine" };
  }
  const startedAt = Date.now();
  const settled = await settleWithin(
    runMountProbeCommand(host, target.path)
      .then((result) => ({ result }))
      .catch((error) => ({ error })),
    MOUNT_PROBE_TIMEOUT_MS,
  );
  const latencyMs = Math.max(0, Date.now() - startedAt);
  if (!settled) {
    return { ...base, latencyMs, error: "Mount probe timed out" };
  }
  if ("error" in settled) {
    return { ...base, latencyMs, error: `${settled.error?.message ?? settled.error}` };
  }
  const { result } = settled;
  if (!result.success) {
    return {
      ...base,
      latencyMs,
      error: firstOutputLine(result.stderr) || firstOutputLine(result.stdout) || "Mount path is not reachable",
    };
  }
  return {
    ...base,
    backend: firstOutputLine(result.stdout) || "path",
    latencyMs,
    healthy: true,
  };
}

async function runMountProbeCommand(host: HostClientFacade, path: string): Promise<CommandExecutionResult> {
  const script = buildMountProbeScript(path);
  if (host.isScoped()) {
    const settings = await host.getSettings();
    return await host.runScopeCommand("sh", ["-lc", script], settings.controller?.scope || "", settings);
  }
  return await host.runHostCommand("sh", ["-lc", script]);
}
