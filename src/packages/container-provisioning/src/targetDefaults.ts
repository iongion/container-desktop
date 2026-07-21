import { ContainerEngine, ContainerEngineHost, Presence } from "@/container-client/types/engine";
import type { CreateMachineOptions } from "@/container-client/types/machine";
import { OperatingSystem } from "@/container-client/types/os";

import { chooseLadderStrategy } from "./planBuilder";
import type { DetectionReport, ProvisionStrategy, ProvisionTarget } from "./types";

function has(detection: DetectionReport, name: string): boolean {
  return detection.programs.some((p) => p.name === name && p.present === Presence.AVAILABLE);
}

// The engine to pre-select for a machine: Apple Container on macOS when present, else an installed engine
// (Podman before Docker), else Podman (the rootless-first default) on a bare machine.
export function preferredEngine(detection: DetectionReport): ContainerEngine {
  if (detection.osType === OperatingSystem.MacOS && has(detection, "container")) {
    return ContainerEngine.APPLE;
  }
  if (has(detection, "podman")) {
    return ContainerEngine.PODMAN;
  }
  if (has(detection, "docker")) {
    return ContainerEngine.DOCKER;
  }
  return ContainerEngine.PODMAN;
}

// The strategy for a chosen engine: Apple Container is always its own rung; otherwise reuse the engine when
// its CLI is already present, else fall to the per-OS create rung (chooseLadderStrategy encodes the ladder).
function strategyFor(engine: ContainerEngine, detection: DetectionReport): ProvisionStrategy {
  if (engine === ContainerEngine.APPLE) {
    return "apple.container";
  }
  if (has(detection, engine === ContainerEngine.PODMAN ? "podman" : "docker")) {
    return "reuse.installed";
  }
  return chooseLadderStrategy(detection);
}

// The connection host for a (strategy, engine). NOTE: reuse.installed maps to the native host here — correct
// on Linux; on macOS/Windows a reused vendor CLI usually fronts a machine/WSL distro, which Phase 2 refines
// (vendor + WSL reuse hosts). The create rungs (lima/wsl) map to their virtualized hosts.
function hostFor(strategy: ProvisionStrategy, engine: ContainerEngine): ContainerEngineHost {
  const podman = engine === ContainerEngine.PODMAN;
  switch (strategy) {
    case "apple.container":
      return ContainerEngineHost.APPLE_NATIVE;
    case "colima.lima":
      return podman ? ContainerEngineHost.PODMAN_VIRTUALIZED_LIMA : ContainerEngineHost.DOCKER_VIRTUALIZED_LIMA;
    case "wsl.import":
      return podman ? ContainerEngineHost.PODMAN_VIRTUALIZED_WSL : ContainerEngineHost.DOCKER_VIRTUALIZED_WSL;
    default:
      return podman ? ContainerEngineHost.PODMAN_NATIVE : ContainerEngineHost.DOCKER_NATIVE;
  }
}

// Derive the full provisioning target (strategy + host) from a chosen engine and the detected environment.
export function targetFor(engine: ContainerEngine, detection: DetectionReport): ProvisionTarget {
  const strategy = strategyFor(engine, detection);
  return { engine, host: hostFor(strategy, engine), strategy };
}

// Only the rungs that create a VM/distro have resources to size — native installs run on the host and
// reuse/apple rungs have nothing to allocate. The resources step hides itself for the rest.
export function needsResources(strategy: ProvisionStrategy): boolean {
  return strategy === "colima.lima" || strategy === "wsl.import";
}

// Sensible starting VM size. ramSize is MB (podman/lima convention); diskSize is GB.
export function defaultResources(): CreateMachineOptions {
  return { name: "container-desktop", cpus: 4, ramSize: 4096, diskSize: 20 };
}
