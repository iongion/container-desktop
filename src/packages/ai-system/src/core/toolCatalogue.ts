// Every tool the assistant can be granted, which toolset it belongs to, and whether it passes the approval gate.
// Lives in core beside the name unions because gated-ness is policy, not machinery, and because the renderer must
// not import the executing tool specs — they drag in the `?raw` description markdown and the workspace-access port
// for no reason. The specs remain the executing authority; this states the same fact where the UI can reach it.

import { CONTAINER_TOOL_NAMES } from "./toolNames";
import { WORKSPACE_TOOL_NAMES } from "./workspaceToolNames";

export type ToolGroup = "container" | "workspace";

export interface ToolCatalogueEntry {
  name: string;
  group: ToolGroup;
  // Gated tools pass the permission gate before running; ungated ones (the reads) execute unattended.
  gated: boolean;
}

// Mutating container tools. Everything else in CONTAINER_TOOL_NAMES is a read.
const GATED_CONTAINER_TOOLS = new Set<string>([
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

// Mutating workspace tools — writes, deletes and process execution.
const GATED_WORKSPACE_TOOLS = new Set<string>(["writeFile", "editFile", "removePath", "execCommand"]);

export const TOOL_CATALOGUE: readonly ToolCatalogueEntry[] = [
  ...CONTAINER_TOOL_NAMES.map(
    (name): ToolCatalogueEntry => ({ name, group: "container", gated: GATED_CONTAINER_TOOLS.has(name) }),
  ),
  ...WORKSPACE_TOOL_NAMES.map(
    (name): ToolCatalogueEntry => ({ name, group: "workspace", gated: GATED_WORKSPACE_TOOLS.has(name) }),
  ),
];

const CATALOGUED_TOOL_NAMES = new Set<string>(TOOL_CATALOGUE.map((entry) => entry.name));

export function isCataloguedToolName(value: string): boolean {
  return CATALOGUED_TOOL_NAMES.has(value);
}
