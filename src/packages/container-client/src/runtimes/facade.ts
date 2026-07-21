import type { CommandExecutionResult } from "@/host-contract/exec";
import type { ILogger } from "@/logger";
// runtimes/facade.ts — the single, symmetric engine facade that EVERY composed HostClient satisfies.
//
// Maximize symmetry — even with no-ops: the facade declares the common surface PLUS all engine-extension
// groups (machines, kube, contexts, swarm, builders, compose). Every host implements the FULL surface —
// real where the engine/host supports it, no-op ([]/false) where it does not — so there are no optional or
// absent members, no per-engine facade split, and no missing-method casts. `capabilities` gates real-vs-no-op
// (the UI renders from it); callers branch on capabilities, never on engine identity.

import type { AxiosInstance } from "axios";
import type EventEmitter from "eventemitter3";

import type {
  ComposeChangeSummary,
  ComposeDownRequest,
  ComposeProject,
  ComposeUpRequest,
} from "@/container-client/compose/types";

import type { ApiConnection, Connection, EngineConnectorSettings } from "@/container-client/types/connection";
import type {
  AvailabilityCheck,
  ContainerEngine,
  ContainerEngineHost,
  EngineConnectorAvailability,
  Program,
} from "@/container-client/types/engine";
import type {
  ApiStartOptions,
  HostExecOptions,
  RunnerStopperOptions,
  StartupStatus,
  SubscriptionOptions,
} from "@/container-client/types/host";
import type {
  ControllerScope,
  CreateMachineOptions,
  PodmanMachine,
  PodmanMachineInspect,
} from "@/container-client/types/machine";
import type {
  SwarmInitOptions,
  SwarmLeaveOptions,
  SwarmNode,
  SwarmService,
  SwarmStack,
} from "@/container-client/types/swarm";
import type { ContextInspect, SystemInfo, SystemPruneReport, SystemResetReport } from "@/container-client/types/system";

// Capabilities (host-adjusted: computed in the HostClient from dialect defaults × transport/host)

export type SortMode = "client" | "server";
export type EngineExtension =
  | "machines"
  | "kube"
  | "contexts"
  | "swarm"
  | "builders"
  | "compose"
  | "registries"
  | "registryTrust"
  | "controllerVersion";

export type ApiSurface = "docker" | "libpod";

export interface CapabilityDescriptor {
  resources: { pods: boolean; secrets: boolean; networks: boolean };
  events: boolean;
  // Per-field sort capability; REST list endpoints are explicit "client" entries until an API exposes sorting.
  sort: Record<string, SortMode>;
  // Which extension groups are real (vs no-op) on this host.
  extensions: Record<EngineExtension, boolean>;
}

// Engine-extension groups — declared once, implemented by EVERY host (real or no-op)

// `machines` — Podman machine lifecycle (real on Podman native/vendor; no-op elsewhere).
export interface MachinesExtension {
  getPodmanMachineInspect(
    name?: string,
    customSettings?: EngineConnectorSettings,
  ): Promise<PodmanMachineInspect | undefined>;
  getPodmanMachines(customFormat?: string, customSettings?: EngineConnectorSettings): Promise<PodmanMachine[]>;
  createPodmanMachine(opts: CreateMachineOptions): Promise<boolean>;
  removePodmanMachine(name: string): Promise<boolean>;
  startPodmanMachine(name: string): Promise<StartupStatus>;
  stopPodmanMachine(name: string): Promise<boolean>;
  restartPodmanMachine(name: string): Promise<boolean>;
  connectToPodmanMachine(name: string, title?: string): Promise<boolean>;
}

// `kube` — Podman kube generation (real on Podman; no-op on Docker).
export interface KubeExtension {
  generateKube(entityId?: any): Promise<CommandExecutionResult>;
}

// `contexts` — `docker context ls/inspect/use` (real on Docker as wired; no-op on Podman).
export interface ContextsExtension {
  getDockerContexts(): Promise<ContextInspect[]>;
  inspectDockerContext(name: string): Promise<ContextInspect | undefined>;
  useDockerContext(name: string): Promise<boolean>;
}

// `swarm` — Docker Swarm services/nodes/stacks (real on Docker as wired; no-op on Podman/Apple).
// Write ops + cluster secrets/configs live on `SwarmAdapter` (Docker-only), not the symmetric facade.
export interface SwarmExtension {
  getSwarmServices(): Promise<SwarmService[]>;
  getSwarmNodes(): Promise<SwarmNode[]>;
  getSwarmStacks(): Promise<SwarmStack[]>;
  swarmInit(opts?: SwarmInitOptions): Promise<boolean>;
  swarmLeave(opts?: SwarmLeaveOptions): Promise<boolean>;
}

// `builders` — `docker buildx ls/use` (real on Docker as wired; no-op on Podman).
export interface BuildersExtension {
  getBuilders(): Promise<any[]>;
  useBuilder(name: string): Promise<boolean>;
}

// `compose` — parse a docker-compose file and orchestrate it as native Podman resources (REAL on Podman).
export interface ComposeExtension {
  getComposeProjects(): Promise<ComposeProject[]>;
  composeUp(request: ComposeUpRequest): Promise<ComposeChangeSummary>;
  composeDown(request: ComposeDownRequest): Promise<boolean>;
}

// The single symmetric facade — every host satisfies ALL of it (real or no-op, gated by capabilities)

export interface HostClientFacade
  extends MachinesExtension,
    KubeExtension,
    ContextsExtension,
    SwarmExtension,
    BuildersExtension,
    ComposeExtension {
  // identity (base.ts:109-114,138)
  LABEL: string;
  PROGRAM: string;
  CONTROLLER: string;
  ENGINE: ContainerEngine;
  HOST: ContainerEngineHost;
  id: string;
  logger: ILogger;
  // Capability matrix (host-adjusted); gates real-vs-no-op extensions + engine-specific UI.
  capabilities: CapabilityDescriptor;
  // The REST API shape this host speaks ("docker" or "libpod"); used by adapters for baseURL/normalizers.
  apiSurface: ApiSurface;

  // lifecycle / API
  startApi(customSettings?: EngineConnectorSettings, opts?: ApiStartOptions): Promise<boolean>;
  stopApi(customSettings?: EngineConnectorSettings, opts?: RunnerStopperOptions): Promise<boolean>;
  isEngineAvailable(): Promise<AvailabilityCheck>;
  isApiRunning(): Promise<AvailabilityCheck>;
  getApiConnection(connection?: Connection, customSettings?: EngineConnectorSettings): Promise<ApiConnection>;
  getApiDriver(): Promise<AxiosInstance>;
  getAvailability(userSettings?: EngineConnectorSettings): Promise<EngineConnectorAvailability>;
  getConnectionDataDir(): Promise<string>;

  // settings
  getSettings(): Promise<EngineConnectorSettings>;
  setSettings(settings: EngineConnectorSettings): Promise<void>;
  getAutomaticSettings(): Promise<EngineConnectorSettings>;
  setLogLevel(level: string): void;

  // scope (controller)
  isScoped(): boolean;
  getControllerScopes(
    customSettings?: EngineConnectorSettings,
    skipAvailabilityCheck?: boolean,
  ): Promise<ControllerScope[]>;
  getControllerDefaultScope(customSettings?: EngineConnectorSettings): Promise<ControllerScope | undefined>;
  startScope(scope: ControllerScope): Promise<StartupStatus>;
  stopScope(scope: ControllerScope): Promise<boolean>;
  startScopeByName(name: string): Promise<StartupStatus>;
  stopScopeByName(name: string): Promise<boolean>;

  // commands / detection
  runHostCommand(
    program: string,
    args?: string[],
    settings?: EngineConnectorSettings,
    execOpts?: HostExecOptions,
  ): Promise<CommandExecutionResult>;
  // Streaming twin of runHostCommand (Command.ExecuteStreaming) — the scoped/remote build streams its wrapper CLI through this.
  runHostCommandStreaming(program: string, args?: string[], settings?: EngineConnectorSettings): Promise<StreamHandle>;
  runScopeCommand(
    program: string,
    args: string[],
    scope: string,
    settings?: EngineConnectorSettings,
    execOpts?: HostExecOptions,
  ): Promise<CommandExecutionResult>;
  // Streaming scoped exec — the scope wrapper streamed via Command.ExecuteStreaming (Native throws).
  runScopeCommandStreaming(
    program: string,
    args: string[],
    scope: string,
    settings?: EngineConnectorSettings,
  ): Promise<StreamHandle>;
  // Translate a LOCAL host path to its guest-side path for a scoped engine (WSL: drive-letter → /mnt/…; Lima/machine/ssh: identity).
  resolveGuestPath(localPath: string, scope: string, settings?: EngineConnectorSettings): Promise<string>;
  findHostProgram(program: Program, settings?: EngineConnectorSettings): Promise<Program>;
  findScopeProgram(program: Program, settings?: EngineConnectorSettings): Promise<Program>;
  findHostProgramVersion(program: Program, settings?: EngineConnectorSettings): Promise<string>;
  findScopeProgramVersion(program: Program, settings?: EngineConnectorSettings): Promise<string>;

  // pods (resource — Podman libpod; no-op on Docker)
  getPodLogs(id?: any, tail?: any): Promise<CommandExecutionResult>;

  // system / events
  getSystemInfo(
    connection?: Connection,
    customFormat?: string,
    customSettings?: EngineConnectorSettings,
  ): Promise<SystemInfo>;
  pruneSystem(opts?: any): Promise<SystemPruneReport>;
  resetSystem(): Promise<SystemResetReport | boolean>;
  getEvents(opts?: SubscriptionOptions): Promise<any[]>;
  getEventsStream(opts?: SubscriptionOptions): Promise<EventEmitter | undefined>;
}

// Capability check — every member is present, so this gates BEHAVIOR (real vs no-op), not type-presence

export function hasExtension(host: HostClientFacade, extension: EngineExtension): boolean {
  return host.capabilities.extensions[extension] === true;
}
