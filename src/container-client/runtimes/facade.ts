// runtimes/facade.ts — the single, symmetric engine facade that EVERY composed HostClient satisfies.
//
// Maximize symmetry — even with no-ops: the facade declares the common surface PLUS all engine-extension
// groups (machines, kube, contexts, swarm, builders, compose). Every host implements the FULL surface —
// real where the engine/host supports it, no-op ([]/false) where it does not — so there are no optional or
// absent members, no per-engine facade split, and no missing-method casts. `capabilities` gates real-vs-no-op
// (the UI renders from it); callers branch on capabilities, never on engine identity.
//
// Verified against runtimes/abstract/base.ts + runtimes/podman/base.ts + Application.ts. The byte-for-byte
// sources (commands/sockets/endpoints) are unchanged; only the surface structure is regularized.

import type { AxiosInstance } from "axios";
import type EventEmitter from "eventemitter3";

import type {
  ApiConnection,
  ApiStartOptions,
  AvailabilityCheck,
  CommandExecutionResult,
  Connection,
  ContainerEngine,
  ContainerEngineHost,
  ContextInspect,
  ControllerScope,
  CreateMachineOptions,
  EngineConnectorAvailability,
  EngineConnectorSettings,
  ILogger,
  PodmanMachine,
  PodmanMachineInspect,
  Program,
  RunnerStopperOptions,
  StartupStatus,
  SubscriptionOptions,
  SystemInfo,
  SystemPruneReport,
  SystemResetReport,
} from "@/env/Types";

// ── Capabilities (host-adjusted: computed in the HostClient from dialect defaults × transport/host) ──

export type SortMode = "client" | "server";
export type EngineExtension =
  | "machines"
  | "kube"
  | "contexts"
  | "swarm"
  | "builders"
  | "compose"
  | "registries"
  | "controllerVersion";

export type ApiSurface = "docker" | "libpod";

export interface CapabilityDescriptor {
  resources: { pods: boolean; secrets: boolean; networks: boolean };
  events: boolean;
  /** Per-field sort capability; REST list endpoints are explicit "client" entries until an API exposes sorting. */
  sort: Record<string, SortMode>;
  /** Which extension groups are real (vs no-op) on this host. */
  extensions: Record<EngineExtension, boolean>;
}

// ── Engine-extension groups — declared once, implemented by EVERY host (real or no-op) ──

/** `machines` — Podman machine lifecycle (real on Podman native/vendor; no-op elsewhere). */
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

/** `kube` — Podman kube generation (real on Podman; no-op on Docker). */
export interface KubeExtension {
  generateKube(entityId?: any): Promise<CommandExecutionResult>;
}

/** `contexts` — `docker context ls/inspect/use` (real on Docker as wired; no-op on Podman). */
export interface ContextsExtension {
  getDockerContexts(): Promise<ContextInspect[]>;
  inspectDockerContext(name: string): Promise<ContextInspect | undefined>;
  useDockerContext(name: string): Promise<boolean>;
}

/** `swarm` — `docker node/service/stack …` (real on Docker as wired; no-op on Podman). */
export interface SwarmExtension {
  getSwarmServices(): Promise<any[]>;
  getSwarmNodes(): Promise<any[]>;
  getSwarmStacks(): Promise<any[]>;
  swarmInit(opts?: any): Promise<boolean>;
  swarmLeave(opts?: any): Promise<boolean>;
}

/** `builders` — `docker buildx ls/use` (real on Docker as wired; no-op on Podman). */
export interface BuildersExtension {
  getBuilders(): Promise<any[]>;
  useBuilder(name: string): Promise<boolean>;
}

/** `compose` — `docker compose …` (real on Docker as wired; no-op on Podman). */
export interface ComposeExtension {
  getComposeProjects(): Promise<any[]>;
  composeUp(opts?: any): Promise<boolean>;
  composeDown(opts?: any): Promise<boolean>;
}

// ── The single symmetric facade — every host satisfies ALL of it (real or no-op, gated by capabilities) ──

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
  /** Capability matrix (host-adjusted); gates real-vs-no-op extensions + engine-specific UI. */
  capabilities: CapabilityDescriptor;
  /** The REST API shape this host speaks ("docker" or "libpod"); used by adapters for baseURL/normalizers. */
  apiSurface: ApiSurface;

  // lifecycle / API
  startApi(customSettings?: EngineConnectorSettings, opts?: ApiStartOptions): Promise<boolean>;
  stopApi(customSettings?: EngineConnectorSettings, opts?: RunnerStopperOptions): Promise<boolean>;
  isEngineAvailable(): Promise<AvailabilityCheck>;
  isApiRunning(): Promise<AvailabilityCheck>;
  getApiConnection(connection?: Connection, customSettings?: EngineConnectorSettings): Promise<ApiConnection>;
  /** Raw Axios driver for the 3 raw consumers (/_ping, /events, /images/search). Replaces getContainerApiClient(). */
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
  runHostCommand(program: string, args?: string[], settings?: EngineConnectorSettings): Promise<CommandExecutionResult>;
  runScopeCommand(
    program: string,
    args: string[],
    scope: string,
    settings?: EngineConnectorSettings,
  ): Promise<CommandExecutionResult>;
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

// ── Capability check — every member is present, so this gates BEHAVIOR (real vs no-op), not type-presence ──

export function hasExtension(host: HostClientFacade, extension: EngineExtension): boolean {
  return host.capabilities.extensions[extension] === true;
}
