// Neutral, dependency-free home for the resource-domain vocabulary + the engine-event → domain mapping.
// Lives in container-client (not in the Zustand store / renderer event manager) so BOTH the renderer and
// the main process can import it without pulling in Zustand or TanStack Query. The store re-exports these
// to keep existing import paths stable.

import type { Container } from "@/container-client/types/container";
import type { ContainerImage } from "@/container-client/types/image";
import type { Network } from "@/container-client/types/network";
import type { Pod } from "@/container-client/types/pod";
import type { Secret } from "@/container-client/types/secret";
import type { Volume } from "@/container-client/types/volume";

export type ResourceDomain = "containers" | "images" | "pods" | "volumes" | "networks" | "secrets";

export const RESOURCE_DOMAINS: ResourceDomain[] = ["containers", "images", "pods", "volumes", "networks", "secrets"];

// Maps each domain to its SINGULAR item type; callers use `ResourceItemsByDomain[D][]` for the list.
export interface ResourceItemsByDomain {
  containers: Container;
  images: ContainerImage;
  pods: Pod;
  volumes: Volume;
  networks: Network;
  secrets: Secret;
}

type EngineEvent = Record<string, any>;

function normalizeEventValue(value: unknown): string {
  return `${value ?? ""}`.trim().toLowerCase();
}

function uniqueDomains(domains: ResourceDomain[]): ResourceDomain[] {
  return Array.from(new Set(domains));
}

// The engine-event → domain mapping, kept in one home so main can use it.
export function normalizeResourceEventDomains(event: EngineEvent): ResourceDomain[] {
  const type = normalizeEventValue(event.Type ?? event.type ?? event.scope ?? event.Kind ?? event.kind);
  const action = normalizeEventValue(event.Action ?? event.action ?? event.Status ?? event.status ?? event.Event);
  // Health-check probes are exec traffic: a container with a HEALTHCHECK emits exec_create/exec_start/exec_die
  // on EVERY probe, none of which change any resource LIST. Drop them here — the single event→domain home —
  // so main never schedules a full list refetch per probe (which happens for every connection, on every
  // screen). health_status is emitted only on a health TRANSITION (not per probe), so it flows through and
  // still refreshes the container's health pill.
  if (action.startsWith("exec")) {
    return [];
  }
  const actorType = normalizeEventValue(event.Actor?.Attributes?.type ?? event.actor?.attributes?.type);
  const value = `${type} ${actorType} ${action}`;
  const domains: ResourceDomain[] = [];

  if (value.includes("container")) {
    domains.push("containers");
    domains.push("pods");
  }
  if (value.includes("pod")) {
    domains.push("pods");
    domains.push("containers");
  }
  if (value.includes("image") || value.includes("pull") || value.includes("push") || value.includes("tag")) {
    domains.push("images");
  }
  if (value.includes("volume")) {
    domains.push("volumes");
  }
  if (value.includes("network")) {
    domains.push("networks");
  }
  if (value.includes("secret")) {
    domains.push("secrets");
  }

  return uniqueDomains(domains);
}
