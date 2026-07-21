import type { ControllerScope } from "./machine";

export interface Program {
  name: string;
  path: string;
  version?: string;
  auto?: boolean;
  title?: string;
  homepage?: string;
}

export interface Controller extends Program {
  scope?: string;
}

export interface DetectFlags {
  program?: boolean;
  controller?: boolean;
  scopes?: boolean;
  connection?: boolean;
}

export interface TestResult extends AvailabilityCheck {
  subject: string;
}

export interface ProgramTestResult extends TestResult {
  program?: {
    path: string;
    version: string;
  };
  scopes?: ControllerScope[];
}

export enum ContainerEngine {
  PODMAN = "podman",
  DOCKER = "docker",
  // Apple's `container` runtime. The enum member stays APPLE; the wire value is "container" (Apple's own
  // name for the tool/CLI — github.com/apple/container), matching APPLE_PROGRAM.
  APPLE = "container",
}

export enum ContainerEngineHost {
  // Podman
  PODMAN_NATIVE = "podman.native",
  PODMAN_VIRTUALIZED_WSL = "podman.virtualized.wsl",
  PODMAN_VIRTUALIZED_LIMA = "podman.virtualized.lima",
  PODMAN_VIRTUALIZED_VENDOR = "podman.virtualized.vendor",
  PODMAN_REMOTE = "podman.remote",
  // Docker
  DOCKER_NATIVE = "docker.native",
  DOCKER_VIRTUALIZED_WSL = "docker.virtualized.wsl",
  DOCKER_VIRTUALIZED_LIMA = "docker.virtualized.lima",
  DOCKER_VIRTUALIZED_VENDOR = "docker.virtualized.vendor",
  DOCKER_REMOTE = "docker.remote",
  // Apple (engine wire value is "container"; members stay APPLE_*)
  APPLE_NATIVE = "container.native",
  APPLE_REMOTE = "container.remote",
}

export enum Presence {
  AVAILABLE = "available",
  MISSING = "missing",
  UNKNOWN = "unknown",
}

export interface ContainerEngineOption {
  engine: ContainerEngine;
  label: string;
  present: Presence;
  disabled?: boolean;
}

export interface AvailabilityCheck {
  success: boolean;
  details?: string | null;
}

export interface EngineConnectorAvailability {
  enabled: boolean;
  host: boolean;
  api: boolean;
  program: boolean;
  controller?: boolean;
  controllerScope?: boolean;
  report: {
    host: string;
    api: string;
    program: string;
    controller?: string;
    controllerScope?: string;
    // Raw, verbatim failure detail (SSH preflight steps / stderr / stack). Surfaced unabridged in the
    // Activity Center so a real connection failure is never reduced to a terse "Not checked" placeholder.
    detail?: string;
  };
}

export interface Distribution {
  distribution: string;
  variant: string;
  version: string;
}

export interface ContainerEngineHostClientCommand {
  launcher?: string;
  command: string[];
  scope?: string;
}
