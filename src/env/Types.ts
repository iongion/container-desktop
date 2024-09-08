import { AxiosRequestHeaders, AxiosResponse, AxiosResponseHeaders } from "axios";

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
  SSHConnection = "SSHConnection"
}

export enum OperatingSystem {
  Browser = "browser",
  Linux = "Linux",
  MacOS = "Darwin",
  Windows = "Windows_NT",
  Unknown = "unknown"
}

export enum Environments {
  DEVELOPMENT = "development",
  PRODUCTION = "production"
}

export enum WindowAction {
  Minimize = "window.minimize",
  Maximize = "window.maximize",
  Restore = "window.restore",
  Close = "window.close"
}

export interface SystemNotification {
  guid: string;
  type: string;
  date: Date;
  data?: any;
}

export interface ApiDriverConfig {
  baseURL: string;
  headers: Partial<Record<string, string>> | AxiosResponseHeaders | AxiosRequestHeaders;
  socketPath?: string | null;
  timeout?: number;
  scope?: string;
}

export interface FileSelection {
  canceled: boolean;
  filePaths: string[];
}

export interface OpenFileSelectorOptions {
  directory?: boolean;
  multiple?: boolean;
  filters?: any;
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

export interface GlobalUserSettings {
  theme: string;
  expandSidebar: boolean;
  startApi: boolean;
  minimizeToSystemTray: boolean;
  checkLatestVersion: boolean;
  path: string;
  logging: {
    level: string;
  };
  connections: Connection[];
  connector: {
    default: string | undefined;
  };
  registries: Registry[];
}

export interface GlobalUserSettingsOptions extends GlobalUserSettings {
  program: Partial<Program>;
  engine: Partial<ContainerEngine>;
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
}

export interface EngineConnectorApiSettings {
  baseURL: string;
  connection: ApiConnection;
  autoStart?: boolean;
}

export interface EngineConnectorSettings {
  api: EngineConnectorApiSettings;
  program: Program;
  controller?: Controller;
  rootfull: boolean;
  mode: "mode.automatic" | "mode.manual";
}

export interface EngineUserSettingsOptions {
  id: string; // engine client instance id
  settings: Partial<EngineConnectorSettings>;
}

export interface EngineApiOptions {
  runtime: ContainerRuntime;
  engine: ContainerEngine;
  id: string; // engine client instance id
  //
  scope: string; // ControllerScope Name
  baseURL: string;
  connection: ApiConnection;
}

export interface EngineProgramOptions {
  runtime: ContainerRuntime;
  engine: ContainerEngine;
  id: string; // engine client instance id
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
}

export type ControllerScope = PodmanMachine | WSLDistribution | LIMAInstance | SSHHost;

export interface ProgramTestResult extends TestResult {
  program?: {
    path: string;
    version: string;
  };
  scopes?: ControllerScope[];
}

export enum ContainerRuntime {
  PODMAN = "podman",
  DOCKER = "docker"
}

export enum ContainerEngine {
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
  DOCKER_REMOTE = "docker.remote"
}

export enum Presence {
  AVAILABLE = "available",
  MISSING = "missing",
  UNKNOWN = "unknown"
}

export interface ContainerRuntimeOption {
  runtime: ContainerRuntime;
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
  engine: boolean;
  api: boolean;
  program: boolean;
  controller?: boolean;
  controllerScope?: boolean;
  report: {
    engine: string;
    api: string;
    program: string;
    controller?: string;
    controllerScope?: string;
  };
}

export interface Connection {
  name: string;
  label: string;
  description?: string;
  runtime: ContainerRuntime;
  engine: ContainerEngine;
  disabled?: boolean;
  readonly?: boolean;
  //
  id: string;
  settings: EngineConnectorSettings;
}

export interface Connector extends Connection {
  connectionId: string;
  description: string;
  notes?: string;
  scopes?: ControllerScope[];
  availability: EngineConnectorAvailability;
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

export interface ContainerClientResult<T = unknown> {
  success: boolean;
  result: T;
  warnings: any[];
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

export interface SystemPlugin {}
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
      usage_in_kernelmode: number;
      usage_in_usermode: number;
    };
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
  Env: string[];
}

// See libpod/define/podstate.go
export enum ContainerStateList {
  CREATED = "created",
  ERROR = "error",
  EXITED = "exited",
  PAUSED = "paused",
  RUNNING = "running",
  DEGRADED = "degraded",
  STOPPED = "stopped"
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
  NetworkSettings?: ContainerNetworkSettings;
  Kube?: string;
  // Computed
  Computed: {
    Name?: string;
    Group?: string;
    NameInGroup?: string;
    DecodedState: ContainerStateList;
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
  Config: {
    Cmd: string[];
    Env: string[];
    ExposedPorts: {
      [key: string]: number;
    };
    StopSignal: string;
    WorkDir: string;
  };
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
  { title: "Read only", type: "ro" },
  { title: "Read / Write", type: "rw" }
];

export enum PodStatusList {
  CREATED = "Created",
  ERROR = "Error",
  EXITED = "Exited",
  PAUSED = "Paused",
  RUNNING = "Running",
  DEGRADED = "Degraded",
  STOPPED = "Stopped",
  DEAD = "Dead"
}

export interface PodContainer {}
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

export interface SystemResetReport {}

export interface FindProgramOptions {
  connection: Connection;
  program: Program;
  insideScope: boolean;
}

export interface ProgramOptions {
  osType: OperatingSystem;
  wrapper?: Wrapper;
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

export interface ContainerClientResponse<T = unknown, D = unknown> extends AxiosResponse<T, D> {
  ok: boolean;
  status: number;
  statusText: string;
  data: T;
  headers: { [key: string]: string };
}

export interface ProxyRequest {
  request: any;
  baseURL: string;
  socketPath?: string;
  engine: ContainerEngine;
  runtime: ContainerRuntime;
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

export interface Registry {
  id: string;
  name: string;
  created: string;
  weight: number;
  enabled: boolean;
  isRemovable: boolean;
  isSystem: boolean;
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

export interface ApiStartOptions {}
export interface RunnerStarterOptions {
  path?: string;
  args?: string[];
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
  polling = "polling"
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
