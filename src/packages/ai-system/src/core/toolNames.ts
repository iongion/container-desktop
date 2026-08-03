import { z } from "zod";
import toolPresentations from "@/resources/ai/tool-presentations.json";

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

const toolPresentation = z.object({
  name: z.enum(CONTAINER_TOOL_NAMES),
  titleKey: z.string().min(1),
  labelKey: z.string().min(1).optional(),
  argument: z.enum(["id", "reference"]).optional(),
  showConnection: z.boolean().optional(),
});

export type ToolPresentation = Omit<z.infer<typeof toolPresentation>, "name">;

const CONTAINER_TOOL_PRESENTATIONS = new Map<ContainerToolName, ToolPresentation>();
const CONTAINER_TOOL_NAME_SET = new Set<string>(CONTAINER_TOOL_NAMES);
for (const { name, ...presentation } of z.array(toolPresentation).parse(toolPresentations)) {
  if (CONTAINER_TOOL_PRESENTATIONS.has(name)) throw new Error(`Duplicate container tool presentation: ${name}`);
  CONTAINER_TOOL_PRESENTATIONS.set(name, presentation);
}
for (const name of CONTAINER_TOOL_NAMES) {
  if (!CONTAINER_TOOL_PRESENTATIONS.has(name)) throw new Error(`Missing container tool presentation: ${name}`);
}

export function isContainerToolName(value: string): value is ContainerToolName {
  return CONTAINER_TOOL_NAME_SET.has(value);
}

export function getContainerToolPresentation(value: string): ToolPresentation | undefined {
  return isContainerToolName(value) ? CONTAINER_TOOL_PRESENTATIONS.get(value) : undefined;
}
