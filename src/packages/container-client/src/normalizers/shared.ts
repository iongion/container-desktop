// normalizers/shared.ts — engine-agnostic canonical transforms shared by both engine normalizers.
//
// Of the resource shapes, only networks genuinely differ between engines (Docker is PascalCase, libpod is
// already canonical) — every other transform already handles both engines (e.g. State as object-vs-string
// is list-vs-inspect, not Podman-vs-Docker), so it stays shared here. The per-engine modules (podman.ts,
// docker.ts) compose these and override only `normalizeNetwork`.

import {
  LABEL_CONTAINER_NUMBER as COMPOSE_CONTAINER_NUMBER_LABEL,
  COMPOSE_PROJECT_LABELS,
  LABEL_SERVICE as COMPOSE_SERVICE_LABEL,
} from "@/container-client/compose/labels";
import type { Container, ContainerStateList } from "@/container-client/types/container";
import type { ContainerImage } from "@/container-client/types/image";
import type { Network } from "@/container-client/types/network";
import type { Pod } from "@/container-client/types/pod";
import type { RegistrySearchOptions, RegistrySearchResult } from "@/container-client/types/registry";
import type { Secret } from "@/container-client/types/secret";
import type { Volume } from "@/container-client/types/volume";

// Container group separators.
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

// Compose project grouping — Docker Desktop's signature container UX. Works for BOTH engines: docker
// compose writes `com.docker.compose.*`, podman-compose writes `io.podman.compose.project` (+ the
// docker.compose.service/container-number labels). Prefer the project label over the name-prefix
// heuristic; keep NameInGroup per-replica-unique (service-number) so scaled services don't render
// duplicate row names. Label keys come from the compose module (single source of truth — the same
// constants the Stacks translator WRITES, so grouping and orchestration can never drift apart).

function computeComposeGroup(
  labels: { [key: string]: string } | null | undefined,
): { group: string; nameInGroup: string } | undefined {
  if (!labels) {
    return undefined;
  }
  const project = COMPOSE_PROJECT_LABELS.map((key) => labels[key]).find(Boolean);
  if (!project) {
    return undefined;
  }
  const service = labels[COMPOSE_SERVICE_LABEL] || "";
  const number = labels[COMPOSE_CONTAINER_NUMBER_LABEL] || "";
  const nameInGroup = service ? (number ? `${service}-${number}` : service) : "";
  return { group: project, nameInGroup };
}

// Healthcheck status from the `/containers/json` list `Status` string — zero extra API calls. Handles BOTH
// engine formats: podman returns the bare word ("healthy" | "unhealthy" | "starting", or "" for none), docker
// a suffix ("Up 2 minutes (healthy)", "(health: starting)"). Returns undefined when there is no healthcheck.
// `unhealthy` is matched before `healthy` (it contains it); container states like "Restarting"/"Exited" that
// merely contain the letters are excluded by word boundaries.
export function parseHealthFromStatus(
  status: string | undefined | null,
): "healthy" | "unhealthy" | "starting" | undefined {
  if (!status) {
    return undefined;
  }
  const value = status.toLowerCase();
  if (/\bunhealthy\b/.test(value)) {
    return "unhealthy";
  }
  if (/health:\s*starting|^starting$|\(\s*starting\s*\)/.test(value)) {
    return "starting";
  }
  if (/\bhealthy\b/.test(value)) {
    return "healthy";
  }
  return undefined;
}

// raw container (list = State string, inspect = State object) → canonical.
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

  // Healthcheck status: prefer the inspect State.Health.Status when present (inspect payloads), else parse the
  // list `Status` string (the merged Containers view) — both go through the same word-level parser.
  const healthFromInspect =
    typeof container.State === "object"
      ? (container.State as { Health?: { Status?: string } })?.Health?.Status
      : undefined;
  container.Computed.Health = parseHealthFromStatus(healthFromInspect ?? container.Status);

  const containerName = normalizeContainerName(`${container.Names?.[0] || container.Name}`);
  if (containerName) {
    container.Computed.Name = containerName;
    const compose = computeComposeGroup(container.Labels);
    if (compose) {
      // Compose project grouping wins over the name heuristic; keep the real container name as the
      // fallback label so a row is never blank.
      container.Computed.Group = compose.group;
      container.Computed.NameInGroup = compose.nameInGroup || containerName;
    } else if (containerName.endsWith("-infra")) {
      // Compute group name - infra suffix
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

// raw image → canonical (Name/Tag/Registry/FullName from Names|NamesHistory|RepoTags).
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

// raw pod → canonical (init Processes/Containers).
export const normalizePod = (pod: Pod): Pod => {
  pod.Processes = {
    Processes: [],
    Titles: [],
  };
  // Containers is null on failure — coerce to an array
  pod.Containers = Array.isArray(pod.Containers) ? pod.Containers : [];
  return pod;
};

// Volume shape is identical across engines (the Docker `{ Volumes: [...] }` list-envelope is unwrapped in the adapter).
export const normalizeVolume = (volume: Volume): Volume => volume;

// Secret shape is identical across engines.
export const normalizeSecret = (secret: Secret): Secret => secret;

// registry search result → canonical (seed Index from the searched registry).
export const normalizeRegistrySearchResult = (
  it: RegistrySearchResult,
  opts: RegistrySearchOptions,
): RegistrySearchResult => {
  if (opts?.registry) {
    it.Index = it.Index || opts?.registry.name;
  }
  return it;
};

// The full per-resource normalizer surface — every engine implements ALL of it (symmetric; only networks differ).
export interface EngineNormalizers {
  normalizeContainer(raw: Container): Container;
  normalizeImage(raw: ContainerImage): ContainerImage;
  normalizePod(raw: Pod): Pod;
  normalizeVolume(raw: Volume): Volume;
  normalizeSecret(raw: Secret): Secret;
  normalizeNetwork(raw: any): Network;
  normalizeRegistrySearchResult(raw: RegistrySearchResult, opts: RegistrySearchOptions): RegistrySearchResult;
}
