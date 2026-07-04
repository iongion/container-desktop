// EngineOps PORT — the typed container-engine operations the assistant's first-class tools call.
// OWNED by core: a neutral interface (type-only imports), implemented MAIN-side over EngineDataService
// (platform/electron — see engineOpsAdapter). The tools (runtimes/agent/containerTools) build their
// AI-SDK definitions from this, and the broker dispatches an APPROVED mutation through the same surface.
// Keeps engine access in MAIN: the renderer never reaches these — it only renders the tool results.
//
// `connectionId` is optional everywhere → the primary/default connection. Reads are ungated; the mutating
// methods are gated by the user's permission mode at the tool layer, never here.

import type { Container, ContainerImage, ContainerStats, Network, Volume } from "@/env/Types";

// A compact connection descriptor the model can use to target a specific engine.
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
  // Discovery
  listConnections(): EngineConnectionInfo[];

  // Containers
  listContainers(opts?: EngineConnectionRef): Promise<Container[]>;
  inspectContainer(opts: EngineEntityRef): Promise<Container | undefined>;
  getContainerLogs(opts: EngineEntityRef & { tail?: number; since?: string }): Promise<string>;
  getContainerStats(opts: EngineEntityRef): Promise<ContainerStats>;
  startContainer(opts: EngineEntityRef): Promise<boolean>;
  stopContainer(opts: EngineEntityRef): Promise<boolean>;
  restartContainer(opts: EngineEntityRef): Promise<boolean>;
  pauseContainer(opts: EngineEntityRef): Promise<boolean>;
  unpauseContainer(opts: EngineEntityRef): Promise<boolean>;
  removeContainer(opts: EngineEntityRef): Promise<boolean>;

  // Images
  listImages(opts?: EngineConnectionRef): Promise<ContainerImage[]>;
  inspectImage(opts: EngineEntityRef): Promise<ContainerImage | undefined>;
  pullImage(opts: EngineConnectionRef & { reference: string }): Promise<boolean>;
  removeImage(opts: EngineEntityRef): Promise<boolean>;

  // Networks
  listNetworks(opts?: EngineConnectionRef): Promise<Network[]>;
  inspectNetwork(opts: EngineEntityRef): Promise<Network>;
  removeNetwork(opts: EngineEntityRef): Promise<boolean>;

  // Volumes
  listVolumes(opts?: EngineConnectionRef): Promise<Volume[]>;
  inspectVolume(opts: EngineEntityRef): Promise<Volume>;
  removeVolume(opts: EngineEntityRef): Promise<boolean>;
}
