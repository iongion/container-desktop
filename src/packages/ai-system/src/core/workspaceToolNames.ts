// The workspace tool id union + guard. Dependency-free (core): no OMA, ai, react, node, electron, tauri. The
// renderer card registry uses `isWorkspaceToolName` to route workspace tool results to the workspace operation cards (container
// tool names route to the container cards; everything else falls back to the generic JSON card).

export const WORKSPACE_TOOL_NAMES = [
  "readFile",
  "listDirectory",
  "statPath",
  "findFiles",
  "searchText",
  "writeFile",
  "editFile",
  "removePath",
  "execCommand",
] as const;

export type WorkspaceToolName = (typeof WORKSPACE_TOOL_NAMES)[number];

const WORKSPACE_TOOL_NAME_SET = new Set<string>(WORKSPACE_TOOL_NAMES);

export function isWorkspaceToolName(value: string): value is WorkspaceToolName {
  return WORKSPACE_TOOL_NAME_SET.has(value);
}
