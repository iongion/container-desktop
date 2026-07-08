import i18n from "@/i18n";

export interface SpawnedProcess {
  pid: any;
  code: any;
  success: boolean;
  stdout?: string;
  stderr?: string;
  command?: any;
  kill: (signal?: NodeJS.Signals | number) => void;
  unref: () => void;
}

export interface ServiceOpts {
  onStatusCheck?: ({ retries, maxRetries }: { retries: number; maxRetries: number }) => void;
  onSpawn?: ({ process, child }: { process: CommandExecutionResult; child: SpawnedProcess }) => void;
  checkStatus: (process: any) => Promise<boolean>;
  retry?: { count: number; wait: number };
  cwd?: string;
  env?: any;
  proxyEnv?: boolean;
}

export enum StartupStatus {
  STARTED = "started",
  STOPPED = "stopped",
  RUNNING = "running", // Already running
  ERROR = "error",
}

export interface ILogger {
  debug: (...args: any[]) => void;
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
}

export enum ControllerScopeType {
  PodmanMachine = "PodmanMachine",
  WSLDistribution = "WSLDistribution",
  LIMAInstance = "LIMAInstance",
  SSHConnection = "SSHConnection",
}

export enum OperatingSystem {
  Browser = "browser",
  Linux = "Linux",
  MacOS = "Darwin",
  Windows = "Windows_NT",
  Unknown = "unknown",
}

export enum Environments {
  DEVELOPMENT = "development",
  PRODUCTION = "production",
}

export enum WindowAction {
  Minimize = "window.minimize",
  Maximize = "window.maximize",
  Restore = "window.restore",
  Close = "window.close",
}

export interface SystemNotification {
  guid: string;
  type: string;
  date: Date;
  data?: any;
}

export interface ApiDriverConfig {
  baseURL: string;
  headers: Partial<Record<string, string>>;
  socketPath?: string | null;
  timeout?: number;
  scope?: string;
  responseType?: any;
}

export interface FileSelection {
  canceled: boolean;
  filePaths: string[];
}

export interface OpenFileSelectorOptions {
  directory?: boolean;
  multiple?: boolean;
  filters?: any;
  /** Starting directory (or file) for the native picker. Honored by both the Electron and Tauri backends. */
  defaultPath?: string;
}

export interface OpenTerminalOptions {
  command?: string;
  // terminal inside machine
  machine?: string;
}

export interface ProxyServiceOptions {
  http?: boolean;
  keepAlive?: boolean;
}

// Apple Container is an engine, not a user-selectable theme — it renders the unified theme by
// definition (see engineTheme.ts / tokens.css). So "container" is intentionally absent here.
export type EngineThemePreference = "auto" | "unified" | "podman" | "docker";

import type { AIProviderSettings, AISettings } from "@/ai-system/core";
import type { ProxyConfig } from "@/container-client/proxy";

// AI subsystem
// Re-exported from @/ai-system/core — the canonical home. Kept here so existing
// consumers (GlobalUserSettings.ai, etc.) don't break.
export type { AIProviderSettings, AISettings };

// Local-only file logging (opt-in, OFF by default). The log file lives under the app's userData
// directory; rotation is size-based with a bounded number of kept files. NEVER a remote/cloud sink.
export interface LoggingFileSettings {
  enabled: boolean;
  // Max size of the active log file before it rotates, in megabytes.
  maxSizeMb: number;
  // How many rotated files to keep (older ones are deleted). Disk use ≈ maxSizeMb * (maxFiles + 1).
  maxFiles: number;
}

// First-run provisioning wizard state, persisted under GlobalUserSettings.wizard.
export interface WizardSettings {
  skipAtStartup: boolean;
  lastCompletedVersion?: string;
  dismissedAt?: string;
  // ISO timestamp written the first time the wizard auto-opens. Its presence is the "already shown once"
  // sentinel that keeps the wizard from auto-opening on every launch (the header button opens it manually).
  firstRunHandledAt?: string;
}

export interface GlobalUserSettings {
  theme: string;
  engineTheme: EngineThemePreference;
  showEngineColumn: boolean;
  expandSidebar: boolean;
  startApi: boolean;
  minimizeToSystemTray: boolean;
  checkLatestVersion: boolean;
  path: string;
  font?: {
    family?: string;
    size?: number;
    weight?: number;
  };
  logging: {
    level: string;
    // File-logging policy (rotation + size caps). Optional for back-compat with older configs;
    // Application.getGlobalUserSettings always populates it via normalizeLoggingFileSettings.
    file?: LoggingFileSettings;
  };
  connections: Connection[];
  connector: {
    default: string | undefined;
  };
  // Auto-reconnect policy applied when a live connection drops (engine stop, SSH broken, internet down).
  // Global default; a connection may override via its api.autoReconnect. Optional for back-compat — main
  // falls back to enabled with a 1s→30s exponential back-off when this is absent.
  reconnect?: {
    enabled: boolean;
    initialMs?: number;
    maxMs?: number;
    factor?: number;
    maxRetries?: number;
  };
  registries: Registry[];
  // AI subsystem settings. Always populated at runtime by normalizeAISettings()
  // in Application.getGlobalUserSettings — opt-in, off by default, local-first.
  ai: AISettings;
  // Global app proxy. Optional for older configs; absence normalizes to disabled at runtime.
  proxy?: ProxyConfig;
  // First-run provisioning wizard state. Optional for back-compat; normalized to { skipAtStartup:false }
  // in getGlobalUserSettings so a fresh config shows the wizard once (the renderer gates on `!== true`).
  wizard?: WizardSettings;
}

export interface GlobalUserSettingsOptions extends GlobalUserSettings {
  program: Partial<Program>;
  host: Partial<ContainerEngineHost>;
}

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

export interface ApiConnection {
  uri: string;
  relay: string;
  // When set, the engine API is reached NOT by `ssh -NL` forwarding `relay`, but by running this command
  // over the SSH link to produce a raw stdio bridge to the daemon — unified across engines (Docker `system
  // dial-stdio` on a Windows named pipe; Podman-machine: a nested OpenSSH hop into the VM + its local
  // dial-stdio). The SSH transport just runs whatever command the dialect resolved (see resolveDialStdioBridge).
  dialStdioCommand?: string[];
}

/** How to bridge an engine whose API can't be `ssh -NL` forwarded: a stable relay id + the command to run. */
export interface DialStdioBridge {
  /** Stable, non-empty id for this bridge (the engine endpoint / machine URI) — the transport's cache key. */
  relay: string;
  /** Command run over the outer SSH to produce a raw stdio bridge to the engine daemon. */
  command: string[];
}

export interface EngineConnectorApiSettings {
  baseURL: string;
  connection: ApiConnection;
  autoStart?: boolean;
  // Per-connection override for auto-reconnect after a drop. Unset = inherit the global default
  // (GlobalUserSettings.reconnect.enabled). true/false force it for this connection.
  autoReconnect?: boolean;
}

export interface EngineConnectorSettings {
  api: EngineConnectorApiSettings;
  program: Program;
  controller?: Controller;
  rootfull: boolean;
  mode: "mode.automatic" | "mode.manual";
  // Per-connection registry trust (Registries & Trust screen + the connection form's advanced sections). All
  // optional: absence = honest defaults (verify TLS, system CA, inherit the global proxy). These are the app's
  // MANAGED set only — the writers read-modify-write registries.conf/certs.d and never wipe user/system entries.
  registries?: RegistryTrustEntry[];
  certificates?: CertAuthority[];
  proxy?: ConnectionProxySettings;
}

export interface EngineUserSettingsOptions {
  id: string; // host client instance id
  settings: Partial<EngineConnectorSettings>;
}

// Extra per-exec options threaded to the underlying process — DISTINCT from EngineConnectorSettings so it never
// clobbers the settings arg. `input` is piped to the child's stdin (registry `login --password-stdin`,
// `cat > ca.crt`) so secret-bearing input never appears in argv or logs. Honored by all three exec backends.
export interface HostExecOptions {
  input?: string;
}

export interface EngineApiOptions {
  engine: ContainerEngine;
  host: ContainerEngineHost;
  id: string; // host client instance id
  //
  scope: string; // ControllerScope Name
  baseURL: string;
  connection: ApiConnection;
}

export interface EngineProgramOptions {
  engine: ContainerEngine;
  host: ContainerEngineHost;
  id: string; // host client instance id
  //
  program: Partial<Program>;
  controller?: Partial<Controller>;
}

export interface SystemConnection {
  Identity: string;
  Name: string;
  URI: string;
}

export interface ProgramOutput {
  stdout?: string | null;
  stderr?: string | null;
}

export interface TestResult extends AvailabilityCheck {
  subject: string;
}

export interface PodmanMachineInspect {
  Name: string;
  ConfigDir: {
    Path: string;
  };
  ConnectionInfo: {
    PodmanSocket?: {
      Path?: string | null;
    };
    PodmanPipe?: {
      Path?: string | null;
    };
  };
  Created: string;
  LastUp: string;
  Resources: {
    CPUs: string;
    DiskSize: number;
    Memory: number;
    USBs: string[];
  };
  SSHConfig: {
    IdentityPath: string;
    Port: number;
    RemoteUsername: string;
  };
  State: string;
  UserModeNetworking: boolean;
  Rootful: boolean;
  Rosetta: boolean;
}

export interface PodmanMachine {
  Name: string;
  Usable: boolean;
  Type: ControllerScopeType;
  // Podman
  Active: boolean;
  Running: boolean;
  LastUp: string;
  VMType: string;
  CPUs?: string;
  Default?: boolean;
  DiskSize?: number;
  Memory?: number;
  Created: string;
}

export interface WSLDistribution {
  Name: string;
  Usable?: boolean;
  Type: ControllerScopeType;
  // WSL
  State: string;
  Version: string;
  Default: boolean;
  Current: boolean;
}

export interface LIMAInstance {
  Name: string;
  Usable?: boolean;
  Type: ControllerScopeType;
  // LIMA
  Status: string;
  SSH: string;
  Arch: string;
  CPUs: string;
  Memory: string;
  Disk: string;
  Dir: string;
}

export interface SSHHost {
  Name: string;
  Connected?: boolean;
  Usable?: boolean;
  Type: ControllerScopeType;
  // SSH
  Host: string;
  Port: number;
  HostName: string;
  User: string;
  IdentityFile: string;
  ConfigHost?: string;
}

export type ControllerScope = PodmanMachine | WSLDistribution | LIMAInstance | SSHHost;

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

export interface Connection {
  logLevel?: string;
  //
  name: string;
  label: string;
  description?: string;
  engine: ContainerEngine;
  host: ContainerEngineHost;
  disabled?: boolean;
  readonly?: boolean;
  //
  id: string;
  settings: EngineConnectorSettings;
}

export interface ConnectorCapabilities {
  resources: {
    pods: boolean;
    secrets: boolean;
    networks: boolean;
  };
  events: boolean;
  sort: Record<string, "client" | "server">;
  extensions: Record<
    | "machines"
    | "kube"
    | "contexts"
    | "swarm"
    | "builders"
    | "compose"
    | "registries"
    | "registryTrust"
    | "controllerVersion",
    boolean
  >;
}

export interface Connector extends Connection {
  connectionId: string;
  description: string;
  notes?: string;
  scopes?: ControllerScope[];
  availability: EngineConnectorAvailability;
  capabilities?: ConnectorCapabilities;
}

export interface ConnectOptions {
  startApi: boolean;
  connection: Connection;
  skipAvailabilityCheck: boolean;
  origin?: string;
}

export interface DisconnectOptions {
  stopApi: boolean;
  connection: Connection;
}

export interface Distribution {
  distribution: string;
  variant: string;
  version: string;
}

export interface SystemVersion {
  APIVersion: string;
  Built: number;
  BuiltTime: string;
  GitCommit: string;
  GoVersion: string;
  OsArch: string;
  Version: string;
}

export type SystemPlugin = any;
export interface SystemPluginMap {
  [key: string]: SystemPlugin;
}

export interface SystemInfoHostRemoteSocket {
  exists: boolean;
  path?: string;
}
export interface SystemInfoHost {
  os: string;
  kernel: string;
  hostname: string;
  distribution: Distribution;
  remoteSocket: SystemInfoHostRemoteSocket;
}

export interface SystemInfoRegistries {
  [key: string]: string[];
}

export interface SystemInfo {
  host: SystemInfoHost;
  plugins: SystemPluginMap;
  registries: SystemInfoRegistries;
  store: any;
  version: SystemVersion;
}

export interface ContextInspect {
  Name: string;
  Metadata: any;
  Endpoints: {
    docker: {
      Host: string;
      SkipTLSVerify: boolean;
    };
  };
  TLSMaterial: any;
  Storage: {
    MetadataPath: string;
    TLSPath: string;
  };
}

// Docker Swarm types (apiSurface "docker" only; Docker REST shapes, passthrough/unnormalized). Lean:
// only the fields list/inspect/write need. Stacks are NOT a REST object — derived by grouping services
// on the `com.docker.stack.namespace` label.

export interface SwarmVersion {
  Index: number;
}

/** GET /swarm — the cluster spec; presence of `ID` means the node is in a swarm. */
export interface SwarmInfo {
  ID: string;
  Version?: SwarmVersion;
  CreatedAt?: string;
  UpdatedAt?: string;
  Spec?: { Name?: string; Labels?: Record<string, string> };
  JoinTokens?: { Worker?: string; Manager?: string };
}

export interface SwarmServicePort {
  Protocol?: string;
  TargetPort?: number;
  PublishedPort?: number;
}

export interface SwarmService {
  ID: string;
  Version?: SwarmVersion;
  CreatedAt?: string;
  UpdatedAt?: string;
  Spec?: {
    Name?: string;
    Labels?: Record<string, string>;
    Mode?: { Replicated?: { Replicas?: number }; Global?: Record<string, never> };
    TaskTemplate?: { ContainerSpec?: { Image?: string } };
  };
  Endpoint?: { Ports?: SwarmServicePort[] };
}

export interface SwarmNode {
  ID: string;
  Version?: SwarmVersion;
  CreatedAt?: string;
  UpdatedAt?: string;
  Spec?: { Role?: "manager" | "worker"; Availability?: "active" | "pause" | "drain"; Labels?: Record<string, string> };
  Description?: {
    Hostname?: string;
    Platform?: { Architecture?: string; OS?: string };
    Engine?: { EngineVersion?: string };
    Resources?: { NanoCPUs?: number; MemoryBytes?: number };
  };
  Status?: { State?: string; Addr?: string };
  ManagerStatus?: { Leader?: boolean; Reachability?: string; Addr?: string };
}

export interface SwarmTask {
  ID: string;
  ServiceID?: string;
  NodeID?: string;
  Slot?: number;
  CreatedAt?: string;
  Spec?: { ContainerSpec?: { Image?: string } };
  Status?: { State?: string; Timestamp?: string; Message?: string };
  DesiredState?: string;
}

/** Derived (not a REST object): one entry per `com.docker.stack.namespace` label across services. */
export interface SwarmStack {
  Name: string;
  Services: number;
  Orchestrator: string;
}

export interface SwarmSecret {
  ID: string;
  Version?: SwarmVersion;
  CreatedAt?: string;
  UpdatedAt?: string;
  Spec?: { Name?: string; Labels?: Record<string, string> };
}

export interface SwarmConfig {
  ID: string;
  Version?: SwarmVersion;
  CreatedAt?: string;
  UpdatedAt?: string;
  Spec?: { Name?: string; Labels?: Record<string, string>; Data?: string };
}

export interface SwarmInitOptions {
  ListenAddr?: string;
  AdvertiseAddr?: string;
  ForceNewCluster?: boolean;
}

export interface SwarmLeaveOptions {
  force?: boolean;
}

/** A host network interface address — a candidate `--advertise-addr` for swarm init. */
export interface HostAddress {
  iface: string;
  address: string;
}

/** Node availability/role change (read-modify-write onto the node's current Spec). */
export interface NodeUpdateOptions {
  Availability?: "active" | "pause" | "drain";
  Role?: "manager" | "worker";
}

export interface SwarmSecretCreateOptions {
  Name: string;
  /** Raw (un-encoded) secret value; the adapter base64-encodes it for the Docker API. */
  Data: string;
  Labels?: Record<string, string>;
}

export interface SwarmConfigCreateOptions {
  Name: string;
  /** Raw (un-encoded) config value; the adapter base64-encodes it for the Docker API. */
  Data: string;
  Labels?: Record<string, string>;
}

export interface ContainerStats {
  read: string;
  preread: string;
  pids_stats: any;
  blkio_stats: {
    io_service_bytes_recursive: any[];
    io_serviced_recursive: null;
    io_queue_recursive: null;
    io_service_time_recursive: null;
    io_wait_time_recursive: null;
    io_merged_recursive: null;
    io_time_recursive: null;
    sectors_recursive: null;
  };
  num_procs: number;
  storage_stats: any;
  cpu_stats: {
    cpu_usage: {
      total_usage: number;
      percpu_usage: number[];
      usage_in_kernelmode: number;
      usage_in_usermode: number;
    };
    system_cpu_usage: number;
    online_cpus: number;
    cpu: number;
    throttling_data: {
      periods: number;
      throttled_periods: number;
      throttled_time: number;
    };
  };
  precpu_stats: {
    cpu_usage: {
      total_usage: number;
      percpu_usage?: number[];
      usage_in_kernelmode: number;
      usage_in_usermode: number;
    };
    system_cpu_usage?: number;
    online_cpus?: number;
    cpu: number;
    throttling_data: {
      periods: number;
      throttled_periods: number;
      throttled_time: number;
    };
  };
  memory_stats: {
    usage: number;
    max_usage: number;
    limit: number;
  };
  name: string;
  Id: string;
  networks: {
    network: {
      rx_bytes: number;
      rx_packets: number;
      rx_errors: number;
      rx_dropped: number;
      tx_bytes: number;
      tx_packets: number;
      tx_errors: number;
      tx_dropped: number;
    };
  };
}

export interface ContainerInspect {
  Cmd: string[];
  Env: string[];
  ExposedPorts: {
    [key: string]: any;
  };
  StopSignal: string;
  WorkDir: string;
}

// See libpod/define/podstate.go
export enum ContainerStateList {
  CREATED = "created",
  ERROR = "error",
  EXITED = "exited",
  PAUSED = "paused",
  RUNNING = "running",
  DEGRADED = "degraded",
  STOPPED = "stopped",
}
export interface ContainerState {
  Dead: boolean;
  Error: string;
  ExitCode: number;
  FinishedAt: string;
  Healthcheck: {
    Status: string;
    FailingStreak: number;
    Log: any;
  };
  OOMKilled: boolean;
  OciVersion: string;
  Paused: boolean;
  Pid: number;
  Restarting: boolean;
  Running: boolean;
  StartedAt: string;
  Status: ContainerStateList;
}

export interface ContainerPort {
  containerPort: number;
  hostPort: number;
  hostIP: string;
  // alternative - why ?!?
  container_port: number;
  host_port: number;
  host_ip: string;
  range: number;
  protocol: string;
  PrivatePort?: number;
  PublicPort?: number;
  Type?: string;
}
export interface ContainerPorts {
  [key: string]: ContainerPort;
}

export interface ContainerNetworkSettingsPorts {
  HostIp: string;
  HostPort: string;
}
export interface ContainerNetworkSettingsPortsMap {
  [key: string]: ContainerNetworkSettingsPorts[];
}

export interface ContainerNetworkSettings {
  EndpointID: string;
  Gateway: string;
  IPAddress: string;
  IPPrefixLen: number;
  IPv6Gateway: string;
  GlobalIPv6Address: string;
  GlobalIPv6PrefixLen: number;
  MacAddress: string;
  Bridge: string;
  SandboxID: string;
  HairpinMode: false;
  LinkLocalIPv6Address: string;
  LinkLocalIPv6PrefixLen: number;
  Ports: ContainerNetworkSettingsPortsMap;
  SandboxKey: string;
}

export interface ContainerConnectOptions {
  id: string;
  title: string;
  shell?: string | null;
}

export interface ContainerHostConfig {
  Runtime: string;
  PortBindings: { [key: string]: ContainerPort[] };
}

export interface Container {
  AutoRemove: boolean;
  Command: string[];
  Created: string;
  CreatedAt: string;
  ExitCode: number;
  Exited: false;
  ExitedAt: number;
  Id: string;
  Image: string;
  ImageName?: string;
  ImageID: string; // For Docker API it is prefixed by sha256:
  IsInfra: boolean;
  Labels: { [key: string]: string } | null;
  Config: ContainerInspect;
  Stats: ContainerStats | null;
  Processes?: any[] | null;
  Logs?: string | Uint8Array;
  Mounts: any[];
  Names: string[];
  Name?: string;
  Namespaces: any;
  Networks: any | null;
  Pid: number;
  Pod: string;
  PodName: string;
  Ports: ContainerPorts;
  Size: any | null;
  StartedAt: number;
  State: ContainerStateList | ContainerState;
  Status: string;
  //
  HostConfig?: ContainerHostConfig;
  NetworkSettings?: ContainerNetworkSettings;
  Kube?: string;
  // Computed
  Computed: {
    Name?: string;
    Group?: string;
    NameInGroup?: string;
    DecodedState: ContainerStateList;
    // Healthcheck status parsed from the list `Status` string (podman bare "healthy"; docker "…(healthy)").
    // Undefined when the container has no healthcheck.
    Health?: "healthy" | "unhealthy" | "starting";
  };
}

export interface ContainerImageHistory {
  id: string;
  created: string;
  Created: string;
  CreatedBy: string;
  Size: number;
  Comment: string;
}

export interface ContainerImage {
  Containers: number;
  Created: number;
  CreatedAt: string;
  Digest: string;
  History: ContainerImageHistory[]; // custom field
  Id: string;
  Labels: {
    maintainer: string;
  } | null;
  Names: string[];
  NamesHistory?: string[];
  ParentId: string;
  RepoTags?: string[];
  SharedSize: number;
  Size: number;
  VirtualSize: number;
  // computed
  Name: string;
  Tag: string;
  Registry: string;
  FullName: string;
  // from detail
  Config: ContainerInspect;
  // Docker specific
  RepoDigests?: string[];
}

export interface SecretSpecDriverOptionsMap {
  [key: string]: string;
}
export interface SecretSpecDriver {
  Name: string;
  Options: SecretSpecDriverOptionsMap;
}
export interface SecretSpec {
  Driver: SecretSpecDriver;
  Name: string;
}
export interface Secret {
  ID: string;
  Spec: SecretSpec;
  CreatedAt: string;
  UpdatedAt: string;
}

export interface Volume {
  Anonymous: boolean;
  CreatedAt: string;
  GID: number;
  UID: number;
  Driver: string;
  Labels: { [key: string]: string };
  Mountpoint: string;
  Name: string;
  Options: { [key: string]: string };
  Scope: string;
  Status: { [key: string]: string };
  // Present only when the engine's volume list is queried with sizes (Docker `?size=true` → UsageData). Podman's
  // libpod list omits it, so it stays undefined there.
  UsageData?: { Size: number; RefCount: number };
}

export interface ContainerImagePortMapping {
  guid: string;
  container_port: number;
  host_ip: string;
  host_port: number;
  protocol: "tcp" | "udp" | "sdp";
}
export interface ContainerImageMount {
  driver: "local";
  device?: string;
  type: "bind" | "tmpfs" | "volume" | "image" | "devpts";
  source?: string;
  destination: string;
  access?: "rw" | "ro";
  size?: number;
}

export const MOUNT_TYPES = ["bind", "tmpfs", "volume", "image", "devpts"];
export const MOUNT_ACCESS = [
  { title: i18n.t("Read only"), type: "ro" },
  { title: i18n.t("Read / Write"), type: "rw" },
];

export enum PodStatusList {
  CREATED = "Created",
  ERROR = "Error",
  EXITED = "Exited",
  PAUSED = "Paused",
  RUNNING = "Running",
  DEGRADED = "Degraded",
  STOPPED = "Stopped",
  DEAD = "Dead",
}

export type PodContainer = any;
export interface PodProcessReport {
  Processes: string[];
  Titles: string[];
}
export interface Pod {
  Cgroup: string;
  Created: string;
  Id: string;
  InfraId: string;
  Labels: { [key: string]: string };
  Name: string;
  NameSpace: string;
  Networks: string[];
  Status: PodStatusList;
  Pid: string;
  NumContainers: number;
  Containers: PodContainer[];
  // computed
  Processes: PodProcessReport;
  Kube?: string;
  Logs?: ProgramOutput;
}

export interface SystemStore {
  configFile: string;
  containerStore: {
    number: number;
    paused: number;
    running: number;
    stopped: number;
  };
}
export interface SystemPruneReport {
  ContainerPruneReports: any;
  ImagePruneReports: any;
  PodPruneReport: any;
  ReclaimedSpace: number;
  VolumePruneReports: any;
}

export type SystemResetReport = any;

export interface FindProgramOptions {
  connection: Connection;
  program: Program;
  insideScope: boolean;
}

export interface ProgramOptions {
  osType: OperatingSystem;
  wrapper?: Wrapper;
}

export interface SubscriptionOptions {
  since?: string;
  until?: string;
  filters?: { [key: string]: string };
  reports?: { type: string; action: string }[];
  attachTimeoutMs?: number;
}

export interface GenerateKubeOptions {
  entityId: string;
}

export interface CreateMachineOptions {
  cpus: number;
  diskSize: number;
  ramSize: number;
  name: string;
}

export interface FetchMachineOptions {
  Name: string; // name or id
}

export interface ProxyRequest {
  request: any;
  baseURL: string;
  socketPath?: string;
  host: ContainerEngineHost;
  engine: ContainerEngine;
  scope?: string;
}

export interface NetworkIPAMOptions {
  [key: string]: string;
}

export interface NetworkSubnetLeaseRange {
  end_ip: string;
  start_ip: string;
}

export interface NetworkSubnet {
  gateway: string;
  lease_range: NetworkSubnetLeaseRange;
  subnet: string;
}

export interface Network {
  created: string;
  dns_enabled: boolean;
  driver: string;
  id: string;
  internal: boolean;
  ipam_options: NetworkIPAMOptions;
  ipv6_enabled: boolean;
  labels: { [key: string]: string };
  name: string;
  network_interface: string;
  options: { [key: string]: string };
  subnets: NetworkSubnet[];
}

// Transport trust for a registry endpoint (matches the Registries & Trust screen's TLS pill).
export type RegistryTlsState = "verify" | "self-signed" | "insecure";
// Sign-in state for a registry (auth.json). `anonymous` + `rateLimited` renders "anonymous · rate-limited".
export interface RegistryAuthInfo {
  kind: "anonymous" | "user" | "pat" | "robot";
  account?: string;
  rateLimited?: boolean;
}

export interface Registry {
  id: string;
  name: string;
  created: string;
  weight: number;
  enabled: boolean;
  isRemovable: boolean;
  isSystem: boolean;
  engine: ContainerEngine[];
  // Optional trust/display state for the Registries & Trust screen. Populated by the mock generator today
  // (demo variety) and by registries.conf/auth.json parsing once wired (handover Steps 3-4); absent on real
  // connections until then, so the UI falls back to honest defaults (verify TLS, anonymous auth, no mirror).
  tls?: RegistryTlsState;
  auth?: RegistryAuthInfo;
  mirrorOf?: string;
}

// Per-connection registry trust (persisted under EngineConnectorSettings.registries — the app's MANAGED
// set, desired state). Serialized into registries.conf/daemon.json by the registryTrust writers.
export interface RegistryTrustEntry {
  name: string;
  tls: RegistryTlsState;
  mirrorOf?: string;
  order: number;
  enabled: boolean;
  // Display-only sign-in state ({kind, account}) — NEVER a secret. The credential lives only in the engine's
  // auth.json (written via `login --password-stdin`); the app keeps nothing.
  auth?: RegistryAuthInfo;
}

// A custom CA the connection trusts (installed into the engine's certs.d). Carries the PEM CONTENT so the
// writer can install it on save/connect; fingerprint/expires/status are populated only when the cert is
// parsed (pure-JS X.509). `installedAt` is an ISO timestamp.
export interface CertAuthority {
  id: string;
  host: string;
  fileName: string;
  fingerprint?: string;
  installedAt: string;
  pem?: string;
  expires?: string;
  status?: "trusted" | "expiring" | "expired";
}

// Per-connection proxy override. `inherit` = use the global GlobalUserSettings.proxy; `override` = use `config`;
// `off` = no proxy for this connection. `config` is only meaningful when mode === "override".
export type ConnectionProxyMode = "inherit" | "override" | "off";
export interface ConnectionProxySettings {
  mode: ConnectionProxyMode;
  config?: ProxyConfig;
}

export interface RegistriesMap {
  default: Registry[];
  custom: Registry[];
}

export interface RegistrySearchFilters {
  isOfficial?: boolean;
  isAutomated?: boolean;
}

export interface RegistrySearchOptions {
  term: string;
  registry: Registry;
  filters: RegistrySearchFilters;
}

export interface RegistryPullOptions {
  image: string;
  onProgress?: (progress: string) => void;
}
export interface RegistrySearchResult {
  Index: string;
  Name: string;
  Description: string;
  Stars: number;
  Official: string;
  Automated: string;
  Tag: string;
}

export interface SecurityVulnerability {
  Severity: string;
  Published: string;
  Description: string;
  VulnerabilityID: string;
  PrimaryURL: string;
  // injected
  guid: string;
}
export interface SecurityReportResultGroup {
  Class: string;
  Target: string;
  Type: string;
  Vulnerabilities: SecurityVulnerability[];
  // injected
  guid: string;
}
export interface SecurityReportResult {
  Results: SecurityReportResultGroup[];
}
export interface SecurityReport {
  provider: string;
  status: "success" | "failure";
  fault?: {
    details: string;
    error: string;
  };
  result?: SecurityReportResult;
  scanner: {
    database: {
      Version: string;
      VulnerabilityDB: {
        DownloadedAt: string;
        NextUpdate: string;
        UpdatedAt: string;
        Version: any;
      };
    };
    name: string;
    path: string;
    version: string;
  };
  counts: {
    CRITICAL: number;
    HIGH: number;
    MEDIUM: number;
    LOW: number;
  };
}

///

export interface ApplicationEnvironment {
  osType: OperatingSystem;
  version: string;
  environment: string;
  provisioned?: boolean;
  running?: boolean;
  messageBus: IMessageBus;
}

export interface ApiStartOptions {
  logLevel?: string;
}
export interface RunnerStarterOptions extends ApiStartOptions {
  path?: string;
  args?: string[];
  proxyEnv?: boolean;
}

export interface RunnerStopperOptions {
  path?: string;
  args?: string[];
}

export interface CommandExecutionResult {
  pid: any;
  code: any;
  success: boolean;
  stdout?: string;
  stderr?: string;
  command?: string;
}

export interface Wrapper {
  launcher: string;
  args: string[];
}

export enum Features {
  polling = "polling",
}
export interface Feature {
  enabled: boolean;
  opts?: any;
}

export type FeaturesMap = {
  [key in Features]?: Feature;
};

export interface EnvironmentSettings {
  api: {
    baseUrl: string;
  };
  poll: {
    rate: number;
  };
}

export interface Environment {
  name: Environments;
  features: FeaturesMap;
  settings: EnvironmentSettings;
}

export interface Domain {
  containers: Container[];
  images: ContainerImage[];
  machines: PodmanMachine[];
  volumes: Volume[];
}
