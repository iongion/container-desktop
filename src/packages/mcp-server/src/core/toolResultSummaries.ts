// The list tools answer with the few fields their descriptions name, not the engine's whole objects: a host's
// containers in full run to hundreds of kilobytes, more than a client will show. The inspect tools keep the full
// object, since the full configuration is what they promise.

import type { EngineContainer, EngineImage, EngineNetwork, EngineVolume } from "@/container-client/engineOps";
import type { ContainerToolName } from "./toolNames";

function containerState(container: EngineContainer): unknown {
  return container.Computed?.DecodedState ?? container.State;
}

// Docker names carry a leading slash (`/web`); the computed name has it stripped already.
function containerName(container: EngineContainer): string | undefined {
  return container.Computed?.Name ?? container.Name ?? container.Names?.[0]?.replace(/^\//, "");
}

function summarizeContainer(container: EngineContainer) {
  return {
    id: container.Id,
    name: containerName(container),
    image: container.ImageName ?? container.Image,
    state: containerState(container),
  };
}

function summarizeImage(image: EngineImage) {
  return { id: image.Id, name: image.Name, tag: image.Tag, size: image.Size };
}

function summarizeNetwork(network: EngineNetwork) {
  return { id: network.id, name: network.name, driver: network.driver };
}

function summarizeVolume(volume: EngineVolume) {
  return { name: volume.Name, driver: volume.Driver, mountpoint: volume.Mountpoint };
}

export function summarizeToolResult(name: ContainerToolName, value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  switch (name) {
    case "listContainers":
      return (value as EngineContainer[]).map(summarizeContainer);
    case "listImages":
      return (value as EngineImage[]).map(summarizeImage);
    case "listNetworks":
      return (value as EngineNetwork[]).map(summarizeNetwork);
    case "listVolumes":
      return (value as EngineVolume[]).map(summarizeVolume);
    default:
      return value;
  }
}
