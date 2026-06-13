// runtimes/composition.ts — the 3-unit composition seam: HostContext + Transport + EngineDialect + HostProfile.
//
// The HostClient (host-client.ts) implements the symmetric HostClientFacade by composing exactly one
// Transport (scope mechanics, per host type) × one EngineDialect (engine commands, per engine) × one
// HostProfile (the thin per-(engine,host) glue). The HostClient IS the HostContext passed to their methods
// — mirroring the existing getContextInspect(client, ...) / getPodmanMachineInspect(client, ...) helpers.
//
// This only factors the 10-leaf inheritance tangle into shared units; the byte-for-byte sources
// (commands / sockets / endpoints) are unchanged.

import type { AxiosInstance } from "axios";

import type { Runner } from "@/container-client/runner";
import type {
  ApiConnection,
  ApiStartOptions,
  AvailabilityCheck,
  CommandExecutionResult,
  Connection,
  ContainerEngine,
  ContainerEngineHost,
  ControllerScope,
  EngineConnectorSettings,
  OperatingSystem,
  RunnerStopperOptions,
  StartupStatus,
  SystemInfo,
} from "@/env/Types";
import type { CapabilityDescriptor, HostClientFacade } from "./facade";

/**
 * The composed host surface that Transport / EngineDialect / HostProfile methods receive — the HostClient
 * itself: the full public facade plus the collaborators + osType the old leaves reached via `this`.
 */
export interface HostContext extends HostClientFacade {
  readonly osType: OperatingSystem;
  readonly transport: Transport;
  readonly dialect: EngineDialect;
  readonly profile: HostProfile;
  readonly runner: Runner;
  /** Scoped `printenv` read (base.ts getScopeEnvironmentVariable) — used by Docker-WSL relay + getConnectionDataDir. */
  getScopeEnvironmentVariable(scope: string, variable: string): Promise<string>;
}

/**
 * The symmetric facade's 23 engine-extension methods, host-bound. A dialect supplies them all (real on its
 * engine, no-op on the other) via `bindExtensions(host)`; the HostClient spreads them onto itself.
 */
export type EngineExtensionMethods = Pick<
  HostClientFacade,
  | "getPodmanMachineInspect"
  | "getPodmanMachines"
  | "createPodmanMachine"
  | "removePodmanMachine"
  | "startPodmanMachine"
  | "stopPodmanMachine"
  | "restartPodmanMachine"
  | "connectToPodmanMachine"
  | "generateKube"
  | "getPodLogs"
  | "getDockerContexts"
  | "inspectDockerContext"
  | "useDockerContext"
  | "getSwarmServices"
  | "getSwarmNodes"
  | "getSwarmStacks"
  | "swarmInit"
  | "swarmLeave"
  | "getBuilders"
  | "useBuilder"
  | "getComposeProjects"
  | "composeUp"
  | "composeDown"
>;

/**
 * Transport — scope mechanics for a host *type* (engine-agnostic). One per:
 * Native / SSH / WSL / LIMA / PodmanMachine. Every transport implements the full interface (Native's
 * scope ops are no-ops), per "maximize symmetry, even with no-ops".
 */
export interface Transport {
  readonly isScoped: boolean;
  shouldKeepStartedScopeRunning(): boolean;
  /** Scoped exec — the byte-for-byte wrapper (NativeTransport throws "Scope is not supported in native mode"). */
  runScopeCommand(
    host: HostContext,
    program: string,
    args: string[],
    scope: string,
    settings?: EngineConnectorSettings,
  ): Promise<CommandExecutionResult>;
  /** Scope discovery — SSH/WSL/LIMA via the shared helpers; Native/PodmanMachine defer to the dialect's machines. */
  listScopes(
    host: HostContext,
    settings?: EngineConnectorSettings,
    skipAvailabilityCheck?: boolean,
  ): Promise<ControllerScope[]>;
  getControllerDefaultScope(
    host: HostContext,
    settings?: EngineConnectorSettings,
  ): Promise<ControllerScope | undefined>;
  startScope(host: HostContext, scope: ControllerScope): Promise<StartupStatus>;
  stopScope(host: HostContext, scope: ControllerScope): Promise<boolean>;
  startScopeByName(host: HostContext, name: string): Promise<StartupStatus>;
  stopScopeByName(host: HostContext, name: string): Promise<boolean>;
  /** Scope-shaped URI for getApiConnection (windows-pipe / LIMA sock / machine socket; "" for native). */
  resolveScopeURI(host: HostContext, settings: EngineConnectorSettings): Promise<string>;
  /** Launch / stop the API in-scope, combining the dialect's service command where applicable (uses host.runner). */
  startApi(host: HostContext, settings?: EngineConnectorSettings, opts?: ApiStartOptions): Promise<boolean>;
  stopApi(host: HostContext, settings?: EngineConnectorSettings, opts?: RunnerStopperOptions): Promise<boolean>;
  /** Raw Axios driver. SSHTransport injects the `getSSHConnection` establishment hook; others use the plain driver. */
  getApiDriver(host: HostContext, settings: EngineConnectorSettings): Promise<AxiosInstance>;
}

/** EngineDialect — engine commands/endpoints + extension implementations. One per engine: Podman / Docker. */
export interface EngineDialect {
  readonly ENGINE: ContainerEngine;
  /** Base capabilities for the engine; the HostProfile host-adjusts these (Finding B). */
  readonly capabilitiesBase: CapabilityDescriptor;
  /** Engine socket read: Podman `system info`→`remoteSocket.path` / Docker `context inspect`→`Endpoints.docker.Host`. */
  readEngineSocket(host: HostContext, settings: EngineConnectorSettings): Promise<string>;
  /** Native/unscoped URI env-seed (Podman `PODMAN_HOST`/`DOCKER_HOST`; Docker `DOCKER_HOST`). */
  resolveNativeURISeed(host: HostContext, settings: EngineConnectorSettings): Promise<string>;
  /** startApi service args (Podman `system service --time=0 unix://<sock> --log-level=<lvl>`; Docker → null = manual). */
  buildServiceArgs(socketPath: string, logLevel: string): string[] | null;
  /** getSystemInfo (Podman overrides for the vendor scope; Docker uses the base host-command form). */
  getSystemInfo(
    host: HostContext,
    connection?: Connection,
    customFormat?: string,
    customSettings?: EngineConnectorSettings,
  ): Promise<SystemInfo>;
  /** The 23 engine-extension methods bound to this host (real on this engine, no-op on the other). */
  bindExtensions(host: HostContext): EngineExtensionMethods;
}

/** HostProfile — the thin per-(engine,host) glue (one per leaf). Holds only what genuinely varies per host. */
export interface HostProfile {
  readonly HOST: ContainerEngineHost;
  readonly LABEL: string;
  /** Verbatim per-host API connection resolver (transport scope-URI ∘ dialect engine-read/seed). */
  getApiConnection(
    host: HostContext,
    connection?: Connection,
    customSettings?: EngineConnectorSettings,
  ): Promise<ApiConnection>;
  /** Per-host OS-availability gate. */
  isEngineAvailable(host: HostContext): Promise<AvailabilityCheck>;
  /** getAutomaticSettings — base detection for most hosts; Docker-vendor returns its reduced variant. */
  getAutomaticSettings(host: HostContext, settings: EngineConnectorSettings): Promise<EngineConnectorSettings>;
  /** Host-adjustments to the dialect's base capabilities (Finding B). */
  adjustCapabilities(base: CapabilityDescriptor): CapabilityDescriptor;
}
