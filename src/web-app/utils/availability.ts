import type { EngineConnectorAvailability } from "@/container-client/types/engine";

export type AvailabilityDimension = "host" | "controller" | "controllerScope" | "program" | "api";

export interface UnavailableReason {
  dimension: AvailabilityDimension;
  reason: string;
}

// Dependency order: an upstream failure is the root cause of every downstream check,
// so the first failing dimension in this order is the most useful reason to surface.
const DIMENSION_ORDER: AvailabilityDimension[] = ["host", "controller", "controllerScope", "program", "api"];

// Derive the most relevant "why is this connection not available" reason from an
// availability report. Returns `undefined` when the API is running (connected) or
// when no availability is known. Optional dimensions (controller/controllerScope)
// are `undefined` for native hosts and are skipped rather than treated as failures.
export function getFirstUnavailableReason(availability?: EngineConnectorAvailability): UnavailableReason | undefined {
  if (!availability || availability.api) {
    return undefined;
  }
  for (const dimension of DIMENSION_ORDER) {
    const ok = availability[dimension];
    if (ok === undefined) {
      continue;
    }
    if (!ok) {
      return { dimension, reason: availability.report?.[dimension] ?? "" };
    }
  }
  return undefined;
}
