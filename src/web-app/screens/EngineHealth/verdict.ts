import type { ConnectionRuntimeInfo } from "@/container-client/resourceSyncProtocol";

// Baseline per-connection health, read purely from the live runtime snapshot (activeRuntime). Panel issues
// (subnet overlaps, slow mounts, …) can DOWNGRADE a healthy verdict to "degraded" later (see issues.ts) — this
// is the transport/runtime floor only. Pure → unit-tested.

export type VerdictLevel = "healthy" | "degraded" | "unreachable";

export interface Verdict {
  level: VerdictLevel;
  reasons: string[];
}

function reconnectReason(runtime: ConnectionRuntimeInfo): string {
  const attempt = typeof runtime.attempt === "number" && runtime.attempt > 0 ? ` (attempt ${runtime.attempt})` : "";
  return `Reconnecting${attempt}…`;
}

export function computeVerdict(runtime: ConnectionRuntimeInfo): Verdict {
  const reconnecting = !!runtime.reconnecting || runtime.phase === "reconnecting";
  const error = runtime.error?.trim();

  if (runtime.phase === "failed") {
    return { level: "unreachable", reasons: [error || "Engine connection failed"] };
  }

  if (!runtime.running) {
    if (runtime.phase === "starting") {
      return { level: "degraded", reasons: ["Starting…"] };
    }
    if (reconnecting) {
      return { level: "degraded", reasons: [reconnectReason(runtime)] };
    }
    return { level: "unreachable", reasons: [error || "Not connected"] };
  }

  // running
  if (reconnecting) {
    return { level: "degraded", reasons: [reconnectReason(runtime)] };
  }
  if (error) {
    return { level: "degraded", reasons: [error] };
  }
  return { level: "healthy", reasons: [] };
}
