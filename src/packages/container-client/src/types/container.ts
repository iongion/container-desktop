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
  // Lowercase on the wire — both engines answer `id`/`name` on the stats route.
  id: string;
  networks: {
    [iface: string]: {
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
  // Docker's inspect spells the same block `Health`; absent on a container without a healthcheck.
  Health?: {
    Status?: string;
    FailingStreak?: number;
    Log?: any;
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
  // Docker's list spelling of the same three fields. `IP` was undeclared until the `Ports` type was
  // fixed — reachability/model.ts reads it, and the `unknown` cast it needed to iterate the list was
  // hiding that too.
  PrivatePort?: number;
  PublicPort?: number;
  IP?: string;
  Type?: string;
}

export interface ContainerNetworkSettingsPorts {
  HostIp: string;
  HostPort: string;
}

// An exposed port with no host binding maps to `null`, not to `[]`: real podman 5.7.0 answers
// `"Ports": {"80/tcp": null}` on a container inspect.
export interface ContainerNetworkSettingsPortsMap {
  [key: string]: ContainerNetworkSettingsPorts[] | null;
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
  // The SAME element shape `NetworkSettings.Ports` carries, not a ContainerPort: both engines answer
  // `{"80/tcp": [{"HostIp": "127.0.0.1", "HostPort": "18899"}]}` here, measured on podman 5.7.0 and
  // Docker 29.7.0 against a container that actually publishes a port. `null` where there is none.
  PortBindings: ContainerNetworkSettingsPortsMap;
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
  // Real podman 5.7.0 answers `"Config": null` on the compat container list (which is the route the
  // list adapter uses), and omits it entirely on the libpod one. Every reader already guards with `?.`.
  Config?: ContainerInspect | null;
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
  Ports: ContainerPort[];
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
