// Leaf helpers shared by the engine's diagnostic probes and by EngineDataService itself, plus the read-only
// view of the caches a probe is given. Nothing here holds state or brings a connection up.

import type { ResourceDomain, ResourceItemsByDomain } from "@/container-client/resourceDomains";
import type { ConnectionRuntimeInfo } from "@/container-client/resourceSyncProtocol";
import type { HostClientFacade } from "@/container-client/runtimes/facade";
import type { ConnectorCapabilities } from "@/container-client/types/connection";

// Per-connection resource state: each domain holds the LIST of its items (ResourceItemsByDomain[D] is singular).
export type ResourceState = { [D in ResourceDomain]: ResourceItemsByDomain[D][] };

export type ConnectionDescriptor = {
  id: string;
  name: string;
  engine: string;
  host?: string;
  capabilities?: ConnectorCapabilities;
};

// What a probe may see: the caches, READ-ONLY. A probe answers a framed question from state the service
// already holds — it never connects, disconnects, or writes to any of these.
export interface EngineProbeView {
  resources: ReadonlyMap<string, ResourceState>;
  hosts: ReadonlyMap<string, HostClientFacade>;
  connections: readonly ConnectionDescriptor[];
  runtimes: ReadonlyMap<string, ConnectionRuntimeInfo>;
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function settleWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return await new Promise<T | undefined>((resolve) => {
    timeout = setTimeout(() => resolve(undefined), timeoutMs);
    timeout.unref?.();
    promise
      .then((value) => resolve(value))
      .catch(() => resolve(undefined))
      .finally(() => {
        if (timeout) {
          clearTimeout(timeout);
        }
      });
  });
}

export function singleQuotePosix(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function firstOutputLine(value?: string): string | undefined {
  return value
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}
