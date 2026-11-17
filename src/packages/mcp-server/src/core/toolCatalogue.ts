// Which container tools mutate an engine. Gated tools pass the permission policy before running; every other name
// in CONTAINER_TOOL_NAMES is a read and runs unattended.
export const GATED_CONTAINER_TOOLS: ReadonlySet<string> = new Set<string>([
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
]);
