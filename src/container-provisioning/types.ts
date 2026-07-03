// Provisioning package — shared types.
//
// Provisioning takes a machine from "nothing installed" to "a usable scope with an engine and
// working volumes", then hands off to the existing connection-startup flow. See
// docs/architecture/provisioning.md for the per-OS priority ladders.
//
// This file is pure declarations (no runtime logic). Logic lives in the sibling modules, each
// covered by a co-located *.test.ts.

import type {
  ContainerEngine,
  ContainerEngineHost,
  CreateMachineOptions,
  OperatingSystem,
  Presence,
} from "@/env/Types";

// Which rung of the per-OS priority ladder a plan targets.
export type ProvisionStrategy = "reuse.installed" | "apple.container" | "colima.lima" | "wsl.import" | "native.install";

// Detection — programs found on PATH, and VMs/distros that exist at the controller level
// (independent of whether an engine is installed inside them — the reuse case).
export interface DetectedProgram {
  name: string;
  present: Presence;
  path?: string;
  version?: string;
}
export interface DetectedScope {
  kind: "podman.machine" | "wsl.distro" | "lima.instance";
  name: string;
  usable: boolean; // engine already reachable inside it
}
export interface DetectionReport {
  osType: OperatingSystem;
  programs: DetectedProgram[];
  scopes: DetectedScope[];
}

// Volume + permission decision (decisionTable output).
export type MountType = "virtiofs" | "native.ext4" | "native.bind" | "apple.native";
export type IdStrategy = "keep-id" | "keep-id+U" | "run-as-user" | "none";
export interface MountDecision {
  mountType: MountType;
  idStrategy: IdStrategy;
  defaultShare: string;
  warn?: string;
}

// A user-chosen shared folder.
export interface VolumeMountSpec {
  hostPath: string;
  guestPath: string;
  mode: "rw" | "ro";
  idStrategy?: IdStrategy;
}

// The decided (engine, host, strategy) + resources + volumes.
export interface ProvisionTarget {
  engine: ContainerEngine;
  host: ContainerEngineHost;
  strategy: ProvisionStrategy;
  resources?: CreateMachineOptions;
  volumes?: VolumeMountSpec[];
}

// A plan is an ordered list of side-effect-free step descriptors.
export type StepKind =
  | "detect"
  | "reuse-scope"
  | "install-engine"
  | "create-vm"
  | "import-distro"
  | "configure-volumes"
  | "verify"
  | "connect";
export interface ProvisionStep {
  id: string;
  kind: StepKind;
  title: string;
  longRunning: boolean;
}
export interface ProvisionPlan {
  target: ProvisionTarget;
  steps: ProvisionStep[];
  reusesExisting: boolean;
  // Rough wall-clock estimate for the whole run (minutes), shown on the review step. Optional so hand-built
  // plan literals (tests) can omit it; buildPlan always sets it.
  estimatedMinutes?: number;
}

// Runtime state, reduced from a stream of StepEvents.
export type StepStatus = "pending" | "running" | "ok" | "failed" | "skipped";
export interface StepRunState {
  id: string;
  status: StepStatus;
  lines: string[];
  error?: string;
}
export type Overall = "idle" | "running" | "done" | "failed";
export interface ProvisionRunState {
  steps: StepRunState[];
  overall: Overall;
  activeStepId?: string;
}
export type StepEvent =
  | { type: "step.start"; id: string }
  | { type: "step.line"; id: string; line: string }
  | { type: "step.ok"; id: string }
  | { type: "step.fail"; id: string; error: string }
  | { type: "step.skip"; id: string; reason: string };

// Readiness — derived from EngineConnectorAvailability + a volume ownership probe.
export interface ReadinessItem {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}
export interface ReadinessReport {
  ready: boolean;
  items: ReadinessItem[];
}

// Persisted under GlobalUserSettings.wizard — single source of truth is env/Types.
export type { WizardSettings } from "@/env/Types";
