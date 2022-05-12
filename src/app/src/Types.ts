// vendors
import React from "react";
// project
import { Platforms } from "./Native";

export interface EngineConnectorApiSettings {
  baseURL: string;
  connectionString: string;
}

export interface EngineConnectorSettings {
  api: EngineConnectorApiSettings;
  program: Program;
  controller?: Controller;
}
export interface EngineConnectorSettingsMap {
  expected: EngineConnectorSettings;
  user: Partial<EngineConnectorSettings>;
  current: EngineConnectorSettings;
}
export interface Connector {
  id: string;
  adapter: ContainerAdapter;
  engine: ContainerEngine;
  availability: {
    all: boolean;
    engine: boolean;
    api: boolean;
    program: boolean;
    controller?: boolean;
    report: {
      engine: string;
      api: string;
      program: string;
      controller?: string;
    }
  };
  settings: EngineConnectorSettingsMap;
  scopes?: ControllerScope[];
}

export interface ConnectOptions {
  startApi: boolean;
  adapter: ContainerAdapter;
  connector: string;
}

export interface GlobalUserSettings {
  startApi: boolean;
  minimizeToSystemTray: boolean;
  path: string;
  logging: {
    level: string;
  };
  connector: {
    default: string | undefined;
  };
}

export interface TestResult {
  subject: string;
  success: boolean;
  details?: any;
}

export interface ProgramTestResult extends TestResult {
  program?: {
    path: string;
    version: string;
  }
  scopes?: ControllerScope[];
}

export interface GlobalUserSettingsOptions extends GlobalUserSettings {
  program: Partial<Program>;
  engine: Partial<ContainerEngine>;
}

export interface EngineUserSettingsOptions {
  id: string; // engine client instance id
  settings: Partial<EngineConnectorSettings>;
}

export interface EngineApiOptions {
  adapter: ContainerAdapter;
  engine: ContainerEngine;
  id: string; // engine client instance id
  //
  scope: string; // ControllerScope Name
  baseURL: string;
  connectionString: string;
}

export interface EngineProgramOptions {
  adapter: ContainerAdapter;
  engine: ContainerEngine;
  id: string; // engine client instance id
  //
  program: Partial<Program>;
  controller?: Partial<Controller>;
}

export enum Environments {
  DEVELOPMENT = "development",
  PRODUCTION = "production"
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

export interface SystemStore {
  configFile: string;
  containerStore: {
    number: number;
    paused: number;
    running: number;
    stopped: number;
  };
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

export interface Distribution {
  distribution: string;
  variant: string;
  version: string;
}

export interface SystemInfoHost {
  os: string;
  kernel: string;
  hostname: string;
  distribution: Distribution;
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

export enum ContainerAdapter {
  PODMAN = "podman",
  DOCKER = "docker",
}

export enum ContainerEngine {
  PODMAN_NATIVE = "podman.native",
  PODMAN_SUBSYSTEM_WSL = "podman.subsystem.wsl",
  PODMAN_SUBSYSTEM_LIMA = "podman.subsystem.lima",
  PODMAN_VIRTUALIZED = "podman.virtualized",
  PODMAN_REMOTE = "podman.remote",
  // Docker
  DOCKER_NATIVE = "docker.native",
  DOCKER_SUBSYSTEM_WSL = "docker.subsystem.wsl",
  DOCKER_SUBSYSTEM_LIMA = "docker.subsystem.lima",
  DOCKER_VIRTUALIZED = "docker.virtualized",
  DOCKER_REMOTE = "docker.remote",
}
export interface SystemConnection {
  Identity: string;
  Name: string;
  URI: string;
}
export interface ApplicationDescriptor {
  environment: string;
  version: string;
  platform: Platforms;
  provisioned: boolean;
  running: boolean;
  // computed
  connectors: Connector[];
  currentConnector: Connector;
  userSettings: GlobalUserSettings;
}

export interface SystemPruneReport {
  ContainerPruneReports: any;
  ImagePruneReports: any;
  PodPruneReport: any;
  ReclaimedSpace: number;
  VolumePruneReports: any;
}

export interface SystemResetReport {}

// Domain
export interface Program {
  name: string;
  path?: string;
  version?: string;
  title?: string;
  homepage?: string;
}

export interface ProgramOutput {
  stdout?: string | null;
  stderr?: string | null;
}

export interface ProgramExecutionResult {
  pid: number;
  success: boolean;
  stdout?: string;
  stderr?: string;
  command: string;
  code: number;
}

export interface Controller {
  path?: string;
  version?: string;
  scope?: string;
}

export interface ContainerClientResponse<T = unknown> {
  ok: boolean;
  status: number;
  statusText: string;
  data: T;
  headers: {[key: string]: string};
}

export interface ContainerClientResult<T = unknown> {
  success: boolean;
  result: T;
  warnings: any[];
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
  Logs?: string[] | null;
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
  DecodedState: ContainerStateList;
  Kube?: string;
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

export interface Machine {
  Name: string;
  Active: boolean;
  Running: boolean;
  LastUp: string;
  VMType: string;
  Created: string;
}

export interface WSLDistribution {
  Name: string;
  State: string;
  Version: string;
  Default: boolean;
  Current: boolean;
}


export interface LIMAInstance {
  Name: string;
  Status: string;
  SSH: string;
  Arch: string;
  CPUs: string;
  Memory: string;
  Disk: string;
  Dir: string;
}

export type ControllerScope = Machine | WSLDistribution | LIMAInstance;

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

export interface Domain {
  containers: Container[];
  images: ContainerImage[];
  machines: Machine[];
  volumes: Volume[];
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
  DEAD = "Dead",
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

// Application types

export interface AppScreenProps {
  navigator: Navigator;
}
export interface AppScreenMetadata {
  ExcludeFromSidebar: boolean;
  WithoutSidebar: boolean;
  LeftIcon: any;
  RightIcon: any;
  RequiresProvisioning: boolean;
  RequiresConnection: boolean;
}
export type AppScreen<AppScreenProps> = React.FunctionComponent<AppScreenProps> & {
  ID: string;
  Title: string;
  Route: {
    Path: string;
  };
  Metadata?: Partial<AppScreenMetadata>;
  isAvailable?: (context: ApplicationDescriptor) => boolean;
};
