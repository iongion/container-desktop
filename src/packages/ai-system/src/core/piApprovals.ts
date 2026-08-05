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
import { TOOL_CATALOGUE } from "./toolCatalogue";
import { isContainerToolName, WEB_SEARCH_TOOL_NAME } from "./toolNames";

// pi's read-only built-ins, plus the app's own web search. Everything else — the mutating built-ins, plugin tools,
// MCP tools — is gated, so a tool nobody has classified yet is asked about rather than run silently.
//
// `webSearch` belongs here because it mutates nothing and because its gate already exists and is explicit: the
// "enable public web search" switch in Settings → AI, off until the user turns it on, enforced by the broker on
// every call. A card per query would ask a second time what that switch answered once — while the real protection,
// that a turn which has read the public web can no longer ride a remembered allow, is the taint the app sets after
// performing one.
// `searchKnowledge` reads curated entries shipped inside the agent image — no engine, no network, no filesystem of
// the user's — so there is nothing for a card to protect. It is a lookup, not an action.
const PI_UNGATED_TOOLS = new Set<string>(["read", "grep", "find", "ls", WEB_SEARCH_TOOL_NAME, "searchKnowledge"]);

// The app's own toolsets — container operations and workspace file/command operations — reach pi over the bridge, so
// their calls arrive here as ordinary tool names. Their read/mutation split is taken from the catalogue the worker
// editor renders rather than restated, so a tool that is re-gated in one place cannot stay ungated in the other.
const APP_TOOL_GATING = new Map<string, boolean>(TOOL_CATALOGUE.map((entry) => [entry.name, entry.gated]));

// A summary long enough to judge a command by, short enough for the timeline item's text limit.
const MAX_SUMMARY_CHARS = 2_000;

export function isPiToolGated(toolName: string): boolean {
  const app = APP_TOOL_GATING.get(toolName);
  if (app !== undefined) return app;
  return !PI_UNGATED_TOOLS.has(toolName);
}

// Which request a call arrives as. pi asks for a verdict on EVERY tool call, so an operation the APP performs is
// decided twice: once before pi runs the tool, and once when the app performs it. Only the second can hold the
// request and run it on approval, so the first must not ask — asking at both turns one removal into two identical
// cards, the second appearing after the user already said yes. The pre-call gate could not be the security boundary
// anyway: an extension can call `engine_op` or `workspace_op` without registering a tool at all.
export type PiToolCallBoundary = "tool-call" | "engine-op" | "workspace-op";

export function decidePiToolCall(input: {
  toolName: string;
  mode: AIPermissionMode;
  cached?: CachedVerdict;
  boundary?: PiToolCallBoundary;
  // The turn is running instructions the app did not author — a skill from an untrusted project source. A
  // remembered allow is not honoured while it is set, so the user sees the call the skill body asked for.
  tainted?: boolean;
}): ToolAction {
  if (input.boundary === "tool-call" && APP_TOOL_GATING.has(input.toolName)) return "run";
  if (!isPiToolGated(input.toolName)) return "run";
  return resolveToolAction({ mode: input.mode, floorBlocked: false, cached: input.cached, tainted: input.tainted });
}

function argText(args: unknown, key: string): string | undefined {
  if (typeof args !== "object" || args === null) return undefined;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

// What the user reads on the approval card: the shell command, the file the call would touch, or — for a
// container mutation — the entity and the connection it lands on. The card already shows the tool name, so
// repeating it there would say nothing; naming the connection matters because a session may act on any of them.
//
// A model usually omits the connection, and the app then fills in the session's own — so the fallback is what
// keeps the card truthful about where a removal lands, on a machine with more than one engine connected. Only the
// TEXT resolves it: the call's arguments stay exactly as the agent sent them, because they are also the identity a
// remembered decision is keyed on.
function containerSummary(toolName: string, args: unknown, defaultConnectionId?: string): string | undefined {
  if (!isContainerToolName(toolName)) return undefined;
  const entity = argText(args, "id") ?? argText(args, "reference");
  if (!entity) return undefined;
  const connectionId = argText(args, "connectionId") ?? defaultConnectionId;
  return connectionId ? `${entity} on ${connectionId}` : entity;
}

export function piApprovalSummary(toolName: string, args: unknown, defaultConnectionId?: string): string {
  const summary =
    argText(args, "command") ??
    argText(args, "path") ??
    containerSummary(toolName, args, defaultConnectionId) ??
    toolName;
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
