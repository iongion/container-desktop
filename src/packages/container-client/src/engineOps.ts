// EngineOps PORT — typed container-engine operations the container tools call. Neutral (type-only), implemented
// over EngineDataService (engineOpsAdapter). Reads are ungated; mutating methods are gated at the tool layer, never
// here. `connectionId` optional everywhere → primary/default connection.
export interface EngineContainer {
  Id: string;
  Image?: string;
  ImageName?: string;
  Name?: string;
  Names?: string[];
  State?: unknown;
  Status?: string;
  Computed?: { Name?: string; DecodedState?: string };
}

export interface EngineImage {
  Id: string;
  Name?: string;
  FullName?: string;
  Names?: string[];
  Tag?: string;
  Size?: number;
}

export interface EngineContainerStats {
  name?: string;
  memory_stats?: { usage?: number; limit?: number };
}

export interface EngineNetwork {
  id: string;
  name: string;
  driver?: string;
  dns_enabled?: boolean;
}

export interface EngineVolume {
  Name: string;
  Driver?: string;
  Mountpoint?: string;
}

export interface EngineConnectionInfo {
  id: string;
  name: string;
  engine: string;
  running: boolean;
}

export interface EngineConnectionRef {
  connectionId?: string;
}

export interface EngineEntityRef extends EngineConnectionRef {
  id: string;
}

export interface EngineOps {
  listConnections(): EngineConnectionInfo[];
  listContainers(opts?: EngineConnectionRef): Promise<EngineContainer[]>;
  inspectContainer(opts: EngineEntityRef): Promise<EngineContainer | undefined>;
  getContainerLogs(opts: EngineEntityRef & { tail?: number; since?: string }): Promise<string>;
  getContainerStats(opts: EngineEntityRef): Promise<EngineContainerStats>;
  startContainer(opts: EngineEntityRef): Promise<boolean>;
  stopContainer(opts: EngineEntityRef): Promise<boolean>;
  restartContainer(opts: EngineEntityRef): Promise<boolean>;
  pauseContainer(opts: EngineEntityRef): Promise<boolean>;
  unpauseContainer(opts: EngineEntityRef): Promise<boolean>;
  removeContainer(opts: EngineEntityRef): Promise<boolean>;
  listImages(opts?: EngineConnectionRef): Promise<EngineImage[]>;
  inspectImage(opts: EngineEntityRef): Promise<EngineImage | undefined>;
  pullImage(opts: EngineConnectionRef & { reference: string }): Promise<boolean>;
  removeImage(opts: EngineEntityRef): Promise<boolean>;
  listNetworks(opts?: EngineConnectionRef): Promise<EngineNetwork[]>;
  inspectNetwork(opts: EngineEntityRef): Promise<EngineNetwork>;
  removeNetwork(opts: EngineEntityRef): Promise<boolean>;
  listVolumes(opts?: EngineConnectionRef): Promise<EngineVolume[]>;
  inspectVolume(opts: EngineEntityRef): Promise<EngineVolume>;
  removeVolume(opts: EngineEntityRef): Promise<boolean>;
}
