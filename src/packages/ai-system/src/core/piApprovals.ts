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

// pi's read-only built-ins. Everything else — the mutating built-ins, plugin tools, MCP tools — is gated, so a
// tool nobody has classified yet is asked about rather than run silently.
const PI_UNGATED_TOOLS = new Set<string>(["read", "grep", "find", "ls"]);

// A summary long enough to judge a command by, short enough for the timeline item's text limit.
const MAX_SUMMARY_CHARS = 2_000;

export function isPiToolGated(toolName: string): boolean {
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

// What the user reads on the approval card: the shell command, or the file the call would touch.
export function piApprovalSummary(toolName: string, args: unknown): string {
  const summary = argText(args, "command") ?? argText(args, "path") ?? toolName;
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
