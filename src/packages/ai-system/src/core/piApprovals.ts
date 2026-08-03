// The app's permission policy applied to pi's tools. The container asks on every call and this decides what
// that means, so there is exactly one decision path — the same `resolveToolAction` the rest of the app uses.
//
// The catastrophic FLOOR is deliberately not applied here. It assumes an args ARRAY and rejects shell
// metacharacters as injection intent; pi's `bash` tool takes a shell string, where a pipe or a redirect is the
// tool working as designed. Its program denylist is also about blast radius on a real machine, and this agent
// runs in a disposable container with only the chosen workspace bind-mounted — the same reasoning the floor's
// own `sandbox` scope already encodes.

import type { AIPermissionMode, CachedVerdict, PermissionDecisionContext, ToolAction } from "./permissions";
import { resolveToolAction } from "./permissions";
import { WORKER_TOOL_CATALOGUE } from "./workerTools";

// pi's read-only built-ins. Everything else — the mutating built-ins, plugin tools, MCP tools — is gated, so a
// tool nobody has classified yet is asked about rather than run silently.
const PI_UNGATED_TOOLS = new Set<string>(["read", "grep", "find", "ls"]);

// The container toolset reaches pi over the bridge, so its calls arrive here as ordinary tool names. Its
// read/mutation split is taken from the catalogue the worker editor renders rather than restated, so a tool that
// is re-gated in one place cannot stay ungated in the other.
const CONTAINER_TOOL_GATING = new Map<string, boolean>(
  WORKER_TOOL_CATALOGUE.filter((entry) => entry.group === "container").map((entry) => [entry.name, entry.gated]),
);

// A summary long enough to judge a command by, short enough for the timeline item's text limit.
const MAX_SUMMARY_CHARS = 2_000;

export function isPiToolGated(toolName: string): boolean {
  const container = CONTAINER_TOOL_GATING.get(toolName);
  if (container !== undefined) return container;
  return !PI_UNGATED_TOOLS.has(toolName);
}

export function decidePiToolCall(input: {
  toolName: string;
  mode: AIPermissionMode;
  cached?: CachedVerdict;
}): ToolAction {
  if (!isPiToolGated(input.toolName)) return "run";
  return resolveToolAction({ mode: input.mode, floorBlocked: false, cached: input.cached });
}

function argText(args: unknown, key: string): string | undefined {
  if (typeof args !== "object" || args === null) return undefined;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

// What the user reads on the approval card: the shell command, the file the call would touch, or — for a
// container mutation — the entity and the connection it lands on. The card already shows the tool name, so
// repeating it there would say nothing; naming the connection matters because a session may act on any of them.
function containerSummary(toolName: string, args: unknown): string | undefined {
  if (!CONTAINER_TOOL_GATING.has(toolName)) return undefined;
  const entity = argText(args, "id") ?? argText(args, "reference");
  if (!entity) return undefined;
  const connectionId = argText(args, "connectionId");
  return connectionId ? `${entity} on ${connectionId}` : entity;
}

export function piApprovalSummary(toolName: string, args: unknown): string {
  const summary = argText(args, "command") ?? argText(args, "path") ?? containerSummary(toolName, args) ?? toolName;
  return summary.length > MAX_SUMMARY_CHARS ? `${summary.slice(0, MAX_SUMMARY_CHARS - 1)}…` : summary;
}

// A remembered verdict must outlive the session that asked for it, so the key is scoped to the workspace and
// the engine connection — never to the per-session container names, which carry a random suffix.
export function piPermissionContext(input: { workspacePath: string; connectionId: string }): PermissionDecisionContext {
  return {
    workspaceId: input.workspacePath,
    targetId: input.connectionId,
    subject: { kind: "access-profile", id: "pi-coding-agent" },
    contentTrustEpoch: "pi",
  };
}
