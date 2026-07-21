export interface SwarmVersion {
  Index: number;
}

// GET /swarm — the cluster spec; presence of `ID` means the node is in a swarm.
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

// Derived (not a REST object): one entry per `com.docker.stack.namespace` label across services.
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

// A host network interface address — a candidate `--advertise-addr` for swarm init.
export interface HostAddress {
  iface: string;
  address: string;
}

// Node availability/role change (read-modify-write onto the node's current Spec).
export interface NodeUpdateOptions {
  Availability?: "active" | "pause" | "drain";
  Role?: "manager" | "worker";
}

export interface SwarmSecretCreateOptions {
  Name: string;
  // Raw (un-encoded) secret value; the adapter base64-encodes it for the Docker API.
  Data: string;
  Labels?: Record<string, string>;
}

export interface SwarmConfigCreateOptions {
  Name: string;
  // Raw (un-encoded) config value; the adapter base64-encodes it for the Docker API.
  Data: string;
  Labels?: Record<string, string>;
}
