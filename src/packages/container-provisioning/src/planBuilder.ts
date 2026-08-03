import { Presence } from "@/container-client/types/engine";
import { OperatingSystem } from "@/container-client/types/os";

import type {
  DetectionReport,
  ProvisionPlan,
  ProvisionStep,
  ProvisionStrategy,
  ProvisionTarget,
  StepKind,
} from "./types";

function hasProgram(detection: DetectionReport, name: string): boolean {
  return detection.programs.some((p) => p.name === name && p.present === Presence.AVAILABLE);
}

// The per-OS priority ladder: reuse an installed engine → prefer the OS-native runtime →
// provision our own VM/distro only as a last resort. See docs/architecture/provisioning.md.
export function chooseLadderStrategy(detection: DetectionReport): ProvisionStrategy {
  const hasEngine = hasProgram(detection, "podman") || hasProgram(detection, "docker");
  switch (detection.osType) {
    case OperatingSystem.Linux:
      return hasEngine ? "reuse.installed" : "native.install";
    case OperatingSystem.MacOS:
      if (hasProgram(detection, "container")) {
        return "apple.container";
      }
      return hasEngine ? "reuse.installed" : "colima.lima";
    case OperatingSystem.Windows:
      return hasEngine ? "reuse.installed" : "wsl.import";
    default:
      throw new Error(`Provisioning is not supported on ${detection.osType}`);
  }
}

// Emit the ordered, side-effect-free execution steps for a decided target. Reuses an existing usable
// VM/distro when one was detected; every plan finishes by configuring volumes, verifying, connecting.
export function buildPlan(detection: DetectionReport, target: ProvisionTarget): ProvisionPlan {
  const steps: ProvisionStep[] = [];
  const add = (kind: StepKind, title: string, longRunning = false) => {
    steps.push({ id: kind, kind, title, longRunning });
  };
  const usable = detection.scopes.find((s) => s.usable);
  let reusesExisting = false;

  switch (target.strategy) {
    case "reuse.installed":
      break;
    case "native.install":
      add("install-engine", "Install engine + compose", true);
      break;
    case "apple.container":
      add("install-engine", "Install Apple Container + socktainer", true);
      break;
    case "colima.lima":
      if (usable) {
        add("reuse-scope", `Reuse ${usable.name}`);
        reusesExisting = true;
      } else {
        add("create-vm", "Create the Linux VM", true);
      }
      add("install-engine", "Ensure engine + compose in the VM", true);
      break;
    case "wsl.import":
      if (usable) {
        add("reuse-scope", `Reuse ${usable.name}`);
        reusesExisting = true;
      } else {
        add("import-distro", "Import the container-desktop distro", true);
      }
      add("install-engine", "Install engine + compose in the distro", true);
      break;
  }

  add("configure-volumes", "Configure shared folders + permissions");
  add("verify", "Verify the engine");
  add("connect", "Connect");
  return { target, steps, reusesExisting, estimatedMinutes: estimateMinutes(steps) };
}

// Rough per-kind minute estimates — the long-running steps (installs, VM create/import) dominate; the rest
// are near-instant. Floored at 1 so a reuse-only plan never reads "0 minutes".
const STEP_MINUTES: Record<StepKind, number> = {
  detect: 0.2,
  "reuse-scope": 0.5,
  "install-engine": 3,
  "create-vm": 4,
  "import-distro": 4,
  "configure-volumes": 0.5,
  verify: 0.5,
  connect: 0.5,
};

export function estimateMinutes(steps: ProvisionStep[]): number {
  const total = steps.reduce((sum, step) => sum + (STEP_MINUTES[step.kind] ?? 1), 0);
  return Math.max(1, Math.round(total));
}
