// Neutral, dependency-free home for the resource-domain vocabulary + the engine-event → domain mapping.
// Lives in container-client (not in the Zustand store / renderer event manager) so BOTH the renderer and
// the main process can import it without pulling in Zustand or TanStack Query. The store re-exports these
// to keep existing import paths stable.

import type { Container, ContainerImage, Network, Pod, Secret, Volume } from "@/env/Types";

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

// Lifted verbatim from resourceEvents.ts so the engine-event → domain mapping has one home that main can use.
export function normalizeResourceEventDomains(event: EngineEvent): ResourceDomain[] {
  const type = normalizeEventValue(event.Type ?? event.type ?? event.scope ?? event.Kind ?? event.kind);
  const action = normalizeEventValue(event.Action ?? event.action ?? event.Status ?? event.status ?? event.Event);
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
