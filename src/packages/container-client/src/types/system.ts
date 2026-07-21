import type { Distribution } from "./engine";

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

// Image disk-usage summarized from GET /system/df — docker (LayersSize + Images[].Size/SharedSize/Containers)
// and libpod (ImagesSize + Images[].UniqueSize/Containers) normalized to one shape (see adapters/systemDf.ts).
export interface SystemDf {
  // Total on-disk bytes of image layers.
  imagesSize: number;
  // Bytes reclaimable by removing images no container references.
  imagesReclaimable: number;
  imagesCount: number;
  reclaimableCount: number;
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
