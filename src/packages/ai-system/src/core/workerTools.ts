// The tool catalogue the worker editor renders: every tool a worker may be granted, which toolset it belongs to,
// and whether it passes the approval gate. Lives in core beside the name unions because gated-ness is policy, not
// machinery — and because the renderer must not import runtime/tools/*Specs, which drag in the `?raw` tool
// description markdown and the workspace-access port for no reason.
//
// The specs remain the executing authority; this is the same fact stated where the UI can reach it.
// runtime/tools/workerToolCatalogue.test.ts asserts the two agree in BOTH directions, so a tool added, removed or
// re-gated in a spec fails the suite instead of silently giving the editor a stale list.

import { CONTAINER_TOOL_NAMES } from "./toolNames";
import { WORKSPACE_TOOL_NAMES } from "./workspaceToolNames";

export type WorkerToolGroup = "container" | "workspace";

export interface WorkerToolEntry {
  name: string;
  group: WorkerToolGroup;
  // Gated tools pass the permission gate before running. Ungated ones (reads) execute unattended in every mode
  // except a worker's "ask" policy — which is the only way to gate a read.
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

export const WORKER_TOOL_CATALOGUE: readonly WorkerToolEntry[] = [
  ...CONTAINER_TOOL_NAMES.map(
    (name): WorkerToolEntry => ({ name, group: "container", gated: GATED_CONTAINER_TOOLS.has(name) }),
  ),
  ...WORKSPACE_TOOL_NAMES.map(
    (name): WorkerToolEntry => ({ name, group: "workspace", gated: GATED_WORKSPACE_TOOLS.has(name) }),
  ),
];

const WORKER_TOOL_NAMES = new Set<string>(WORKER_TOOL_CATALOGUE.map((entry) => entry.name));

export function isWorkerToolName(value: string): boolean {
  return WORKER_TOOL_NAMES.has(value);
}

export function workerToolsByGroup(group: WorkerToolGroup): WorkerToolEntry[] {
  return WORKER_TOOL_CATALOGUE.filter((entry) => entry.group === group);
}

// Drop names that are no longer real tools. A stored allowlist outlives the build that wrote it, so a removed or
// renamed tool must not travel to the host as a grant it cannot interpret.
export function retainKnownWorkerTools(allowed: readonly string[]): string[] {
  return allowed.filter((name) => WORKER_TOOL_NAMES.has(name));
}
