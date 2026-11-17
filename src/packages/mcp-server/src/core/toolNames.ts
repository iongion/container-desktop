// The container tools this app serves, by name. One list so the dispatcher, the catalogue and the gating table
// agree on what exists.
export const CONTAINER_TOOL_NAMES = [
  "listConnections",
  "listContainers",
  "inspectContainer",
  "getContainerLogs",
  "getContainerStats",
  "listImages",
  "inspectImage",
  "listNetworks",
  "inspectNetwork",
  "listVolumes",
  "inspectVolume",
  "startContainer",
  "stopContainer",
  "restartContainer",
  "pauseContainer",
  "unpauseContainer",
  "removeContainer",
  "removeImage",
  "removeNetwork",
  "removeVolume",
  "pullImage",
] as const;

export type ContainerToolName = (typeof CONTAINER_TOOL_NAMES)[number];

const CONTAINER_TOOL_NAME_SET = new Set<string>(CONTAINER_TOOL_NAMES);

export function isContainerToolName(value: string): value is ContainerToolName {
  return CONTAINER_TOOL_NAME_SET.has(value);
}
