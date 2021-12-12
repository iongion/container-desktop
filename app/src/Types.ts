import React from "react";
import { Platforms } from "./Native";

export interface ConnectOptions {
  autoStart: boolean;
}

export enum Environments {
  DEVELOPMENT = "development",
  PRODUCTION = "production"
}

export enum Features {
  polling = "polling",
  customizeMounts = "customizeMounts",
  engineSwitcher = "engineSwitcher"
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
export interface SystemInfo {
  host: any;
  plugins: SystemPluginMap;
  registries: any;
  store: any;
  version: SystemVersion;
}

export enum SystemServiceEngineType {
  native = "native",
  remote = "remote",
  wsl = "virtualized.wsl",
  lima = "virtualized.lima"
}
export interface SystemConnection {
  Identity: string;
  Name: string;
  URI: string;
}
export interface SystemEnvironment {
  connections: SystemConnection[];
  program: Program;
  running: boolean;
  info: SystemInfo;
}
export interface SystemStartInfo {
  system: SystemInfo;
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
  currentVersion?: string;
  title: string;
  homepage: string;
  platform: Platforms;
}

export interface ContainerClientResponse<T = unknown> {
  success: boolean;
  body: T;
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
  Status: string;
}

export interface ContainerPort {
  hostPort: number;
  containerPort: number;
  protocol: string;
  hostIP: string;
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
  ImageID: string;
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
  State: string | ContainerState;
  Status: string;
  //
  NetworkSettings?: ContainerNetworkSettings;
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
  };
  Names: string[];
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
}

export interface Machine {
  Name: string;
  Active: boolean;
  Running: boolean;
  LastUp: string;
  VMType: string;
  Created: string;
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

export interface Domain {
  containers: Container[];
  images: ContainerImage[];
  machines: Machine[];
  volumes: Volume[];
}

export interface ContainerImagePortMapping {
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

export interface WSLDistribution {
  name: string;
}

export type AppScreen<P> = React.FunctionComponent<P> & {
  ID: string;
  Title: string;
  Route: {
    Path: string;
  };
  Metadata?: {
    ExcludeFromSidebar?: boolean;
    LeftIcon?: any;
    RightIcon?: any;
  };
};
