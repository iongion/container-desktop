// What the provisioning wizard may offer on a given OS. The wizard must never surface an engine or transport
// that's impossible on the current platform (Apple Container + Lima are macOS-only; WSL is Windows-only), both
// because it's noise and because picking an impossible combo breaks downstream steps (e.g. the volume decision
// table throws for Apple Container off macOS). This is the single source of truth that gates the engine
// selector and the system-check probe list; strategies/hosts stay encoded in planBuilder + decisionTable.

import { ContainerEngine, OperatingSystem } from "@/env/Types";

export interface OSCapabilities {
  // Engines that are actually selectable on this OS (Apple Container is macOS-only).
  engines: ContainerEngine[];
  // Programs the system-check step probes + lists (podman/docker everywhere; the rest are OS-specific).
  probes: string[];
}

// Every engine the wizard displays, in card order. The engine step always renders all of them and *disables*
// the ones not in capabilitiesFor(os).engines — so users on Linux still see Apple Container (with its badge)
// but can't select it. Kept as the superset of every OS's selectable engines.
export const WIZARD_ENGINES: ContainerEngine[] = [
  ContainerEngine.PODMAN,
  ContainerEngine.DOCKER,
  ContainerEngine.APPLE,
];

// podman/docker are provisionable on every OS; ssh is always relevant (remote engines, never impossible).
// container = Apple Container (macOS), limactl = Lima VM (macOS), wsl = WSL2 distro (Windows).
const TABLE: Partial<Record<OperatingSystem, OSCapabilities>> = {
  [OperatingSystem.Linux]: {
    engines: [ContainerEngine.PODMAN, ContainerEngine.DOCKER],
    probes: ["podman", "docker", "ssh"],
  },
  [OperatingSystem.MacOS]: {
    engines: [ContainerEngine.PODMAN, ContainerEngine.DOCKER, ContainerEngine.APPLE],
    probes: ["podman", "docker", "container", "limactl", "ssh"],
  },
  [OperatingSystem.Windows]: {
    engines: [ContainerEngine.PODMAN, ContainerEngine.DOCKER],
    probes: ["podman", "docker", "wsl", "ssh"],
  },
};

// Resolve the wizard's capabilities for an OS. Unknown/unsupported platforms get nothing to offer (the wizard
// shows a graceful unsupported state). Returns fresh arrays so callers can't mutate the shared table.
export function capabilitiesFor(os: OperatingSystem): OSCapabilities {
  const caps = TABLE[os];
  return caps ? { engines: [...caps.engines], probes: [...caps.probes] } : { engines: [], probes: [] };
}
