// EngineOps adapter (MAIN). Implements the neutral EngineOps port (core/engineOps) over the live
// EngineDataService — the same host clients + container-client adapters the rest of the app uses. This is
// the bridge that lets the assistant's typed tools drive the real engines while keys + execution stay in
// MAIN. `connectionId` defaults to the primary connection; a missing/unconnected target throws a friendly
// error the tool layer surfaces. Lifecycle ops route through performAction so the resource store refreshes;
// other mutations (image/network/volume remove, image pull) trigger a domain refresh explicitly.

import type { EngineConnectionInfo, EngineOps } from "@/ai-system/core";
import { ContainersAdapter } from "@/container-client/adapters/containers";
import { ImagesAdapter } from "@/container-client/adapters/images";
import { NetworksAdapter } from "@/container-client/adapters/networks";
import { VolumesAdapter } from "@/container-client/adapters/volumes";
import type { HostClientFacade } from "@/container-client/runtimes/facade";

import type { EngineDataService } from "./engineDataService";

export function createEngineOpsAdapter(service: EngineDataService): EngineOps {
  // Resolve {connectionId, host} for an operation — defaults to the primary connection.
  function resolve(connectionId?: string): { connectionId: string; host: HostClientFacade } {
    const id = connectionId ?? service.getAppRuntimeSnapshot().currentConnector?.id;
    if (!id) {
      throw new Error("No active container connection. Connect an engine first.");
    }
    const host = service.getHost(id);
    if (!host) {
      throw new Error(`Connection "${id}" is not running.`);
    }
    return { connectionId: id, host };
  }

  const containers = (connectionId?: string) => new ContainersAdapter(resolve(connectionId).host);
  const images = (connectionId?: string) => new ImagesAdapter(resolve(connectionId).host);
  const networks = (connectionId?: string) => new NetworksAdapter(resolve(connectionId).host);
  const volumes = (connectionId?: string) => new VolumesAdapter(resolve(connectionId).host);

  return {
    listConnections(): EngineConnectionInfo[] {
      return service.getAppRuntimeSnapshot().connections.map((c) => ({
        id: c.id,
        name: c.name,
        engine: c.engine,
        running: !!service.getHost(c.id),
      }));
    },

    // Containers — reads
    listContainers: ({ connectionId } = {}) => containers(connectionId).list(),
    inspectContainer: ({ connectionId, id }) => containers(connectionId).get(id),
    getContainerLogs: ({ connectionId, id, tail, since }) => containers(connectionId).logs(id, { tail, since }),
    getContainerStats: ({ connectionId, id }) => containers(connectionId).stats(id),

    // Containers — lifecycle (via performAction so the resource snapshot refreshes)
    startContainer: async ({ connectionId, id }) => {
      const { host, connectionId: cid } = resolve(connectionId);
      await service.performAction("container.start", id, host, cid);
      return true;
    },
    stopContainer: async ({ connectionId, id }) => {
      const { host, connectionId: cid } = resolve(connectionId);
      await service.performAction("container.stop", id, host, cid);
      return true;
    },
    restartContainer: async ({ connectionId, id }) => {
      const { host, connectionId: cid } = resolve(connectionId);
      await service.performAction("container.restart", id, host, cid);
      return true;
    },
    pauseContainer: async ({ connectionId, id }) => {
      const { host, connectionId: cid } = resolve(connectionId);
      await service.performAction("container.pause", id, host, cid);
      return true;
    },
    unpauseContainer: async ({ connectionId, id }) => {
      const { host, connectionId: cid } = resolve(connectionId);
      await service.performAction("container.unpause", id, host, cid);
      return true;
    },
    removeContainer: async ({ connectionId, id }) => {
      const { host, connectionId: cid } = resolve(connectionId);
      const ok = await new ContainersAdapter(host).remove(id);
      await service.refresh(cid, "containers", host).catch(() => undefined);
      return ok;
    },

    // Images
    listImages: ({ connectionId } = {}) => images(connectionId).list(),
    inspectImage: ({ connectionId, id }) => images(connectionId).get(id),
    pullImage: async ({ connectionId, reference }) => {
      const { host, connectionId: cid } = resolve(connectionId);
      const ok = await new ImagesAdapter(host).pull(reference);
      await service.refresh(cid, "images", host).catch(() => undefined);
      return ok;
    },
    removeImage: async ({ connectionId, id }) => {
      const { host, connectionId: cid } = resolve(connectionId);
      const ok = await new ImagesAdapter(host).remove(id);
      await service.refresh(cid, "images", host).catch(() => undefined);
      return ok;
    },

    // Networks
    listNetworks: ({ connectionId } = {}) => networks(connectionId).list(),
    inspectNetwork: ({ connectionId, id }) => networks(connectionId).get(id),
    removeNetwork: async ({ connectionId, id }) => {
      const { host, connectionId: cid } = resolve(connectionId);
      const ok = await new NetworksAdapter(host).remove(id);
      await service.refresh(cid, "networks", host).catch(() => undefined);
      return ok;
    },

    // Volumes
    listVolumes: ({ connectionId } = {}) => volumes(connectionId).list(),
    inspectVolume: ({ connectionId, id }) => volumes(connectionId).get(id),
    removeVolume: async ({ connectionId, id }) => {
      const { host, connectionId: cid } = resolve(connectionId);
      const ok = await new VolumesAdapter(host).remove(id);
      await service.refresh(cid, "volumes", host).catch(() => undefined);
      return ok;
    },
  };
}
