// What an MCP client may do, by the mode the user picks in settings. Reads always run. The tools that change an
// engine (GATED_CONTAINER_TOOLS) run only in `allow`, where their annotations tell the client to ask its own user;
// in `read-only` they are still listed, and a call to one is refused with where the user allows changes.

import { GATED_CONTAINER_TOOLS } from "./toolCatalogue";
import type { ContainerToolName } from "./toolNames";

export const MCP_PERMISSION_MODES = ["read-only", "allow"] as const;

export type McpPermissionMode = (typeof MCP_PERMISSION_MODES)[number];

export const DEFAULT_MCP_PERMISSION_MODE: McpPermissionMode = "read-only";

// Fails closed: any mode but an explicit `allow` keeps the gated tools shut.
export function isToolAllowed(mode: McpPermissionMode, name: ContainerToolName): boolean {
  return mode === "allow" || !GATED_CONTAINER_TOOLS.has(name);
}
