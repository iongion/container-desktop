// normalizers/shared.ts — engine-agnostic canonical transforms shared by both engine normalizers.
//
// Of the resource shapes, only networks genuinely differ between engines (Docker is PascalCase, libpod is
// already canonical) — every other transform already handles both engines (e.g. State as object-vs-string
// is list-vs-inspect, not Podman-vs-Docker), so it stays shared here. The per-engine modules (podman.ts,
// docker.ts) compose these and override only `normalizeNetwork`.

import type {
  Container,
  ContainerImage,
  ContainerStateList,
  Network,
  Pod,
  RegistrySearchOptions,
  RegistrySearchResult,
  Secret,
  Volume,
} from "@/env/Types";

/** Container group separators. */
export const CONTAINER_GROUP_SEPARATORS = ["-", "_"];

function normalizeContainerName(name: string): string {
  return name.replace(/^\/+/, "");
}

function splitContainerGroupName(containerName: string) {
  const separatorIndex = CONTAINER_GROUP_SEPARATORS.map((separator) => containerName.indexOf(separator))
    .filter((index) => index > 0)
    .sort((a, b) => a - b)[0];
  if (!separatorIndex) {
    return {
      groupName: containerName,
      containerNameInGroup: "",
    };
  }
  return {
    groupName: containerName.slice(0, separatorIndex),
    containerNameInGroup: containerName.slice(separatorIndex + 1),
  };
}

/** raw container (list = State string, inspect = State object) → canonical. */
export const normalizeContainer = (container: Container): Container => {
  if (container.ImageName) {
    container.Image = container.ImageName;
  }

  // container.Logs = container.Logs;
  container.Ports = container.Ports || [];

  if (!container.Computed) {
    container.Computed = {} as any;
  }

  if (typeof container.State === "object") {
    container.Computed.DecodedState = container.State.Status as ContainerStateList;
  } else {
    container.Computed.DecodedState = container.State as ContainerStateList;
  }

  const containerName = normalizeContainerName(`${container.Names?.[0] || container.Name}`);
  if (containerName) {
    container.Computed.Name = containerName;
    // Compute group name - infra suffix
    if (containerName.endsWith("-infra")) {
      container.Computed.Group = "Pod infrastructure";
      container.Computed.NameInGroup = containerName.replace("-infra", "");
    } else {
      // Compute group name - Name prefix
      const { groupName, containerNameInGroup } = splitContainerGroupName(containerName);
      container.Computed.Group = groupName;
      container.Computed.NameInGroup = containerNameInGroup;
    }
  }
  return container;
};

/** raw image → canonical (Name/Tag/Registry/FullName from Names|NamesHistory|RepoTags). */
export const normalizeImage = (image: ContainerImage): ContainerImage => {
  let info = "";
  let tag = "";
  let name = "";
  let registry = "";
  const nameSource = image.Names || image.NamesHistory;
  const parts = (nameSource ? nameSource[0] || "" : "").split(":");
  [info, tag] = parts;
  let paths: string[] = [];
  [registry, ...paths] = info.split("/");
  name = paths.join("/");
  if (!tag) {
    if (image.RepoTags) {
      const fromTag = image.RepoTags[0] || "";
      name = fromTag.slice(0, fromTag.indexOf(":"));
      tag = fromTag.slice(fromTag.indexOf(":") + 1);
    }
  }
  image.Name = name;
  image.Tag = tag;
  image.Registry = registry || "docker.io";
  image.FullName = tag ? `${name}:${tag}` : name;
  image.History = [];
  return image;
};

/** raw pod → canonical (init Processes/Containers). */
export const normalizePod = (pod: Pod): Pod => {
  pod.Processes = {
    Processes: [],
    Titles: [],
  };
  // Containers is null on failure — coerce to an array
  pod.Containers = Array.isArray(pod.Containers) ? pod.Containers : [];
  return pod;
};

/** Volume shape is identical across engines (the Docker `{ Volumes: [...] }` list-envelope is unwrapped in the adapter). */
export const normalizeVolume = (volume: Volume): Volume => volume;

/** Secret shape is identical across engines. */
export const normalizeSecret = (secret: Secret): Secret => secret;

/** registry search result → canonical (seed Index from the searched registry). */
export const normalizeRegistrySearchResult = (
  it: RegistrySearchResult,
  opts: RegistrySearchOptions,
): RegistrySearchResult => {
  if (opts?.registry) {
    it.Index = it.Index || opts?.registry.name;
  }
  return it;
};

/** The full per-resource normalizer surface — every engine implements ALL of it (symmetric; only networks differ). */
export interface EngineNormalizers {
  normalizeContainer(raw: Container): Container;
  normalizeImage(raw: ContainerImage): ContainerImage;
  normalizePod(raw: Pod): Pod;
  normalizeVolume(raw: Volume): Volume;
  normalizeSecret(raw: Secret): Secret;
  normalizeNetwork(raw: any): Network;
  normalizeRegistrySearchResult(raw: RegistrySearchResult, opts: RegistrySearchOptions): RegistrySearchResult;
}
