// AI permission policy
// OWNED by core. Pure decision logic — no node:/React. The user picks a global mode; the agent
// is always tool-capable. There is NO auto-run-by-classification: the user (not a heuristic) decides.
//
//   "ask"      — Always ask: every gated tool call prompts; the cache is ignored, nothing is remembered.
//   "remember" — Ask, approve or reject: prompt ONLY for a not-yet-decided command; cached allow → run,
//                cached block → reject; the decision is persisted to the policy file.
//   "allow"    — Always allow: no prompt, no cache, no floor — run anything (explicit user opt-in).
//
// The "floor" (catastrophic denylist + shell-metachars + traversal) is computed elsewhere (sandbox) and
// passed in as `floorBlocked`; it is enforced in ask + remember, and bypassed in allow.
import type { z } from "zod";
import type { permissionRule, permissionsList, permissionsSnapshot } from "./schemas";

export type AIPermissionMode = "ask" | "remember" | "allow";

export type ToolAction = "run" | "ask" | "reject";

// The remembered verdict for one exact, scoped operation, persisted in the permissions cache.
export type CachedVerdict = "allow" | "block" | undefined;

export interface PermissionDecisionContext {
  workspaceId: string;
  targetId: string;
  subject: { kind: "access-profile"; id: string } | { kind: "server"; id: string };
  contentTrustEpoch: string;
}

export function permissionKey(rule: PermissionRule): string {
  const { addedAt: _addedAt, ...decision } = rule;
  return stableStringify(decision);
}

export function toolRule(
  context: PermissionDecisionContext,
  toolName: string,
  args: unknown,
  serverId?: string,
): PermissionRule {
  return {
    ...context,
    operation: { kind: "tool", id: toolName, ...(serverId ? { serverId } : {}) },
    normalizedArgs: normalizePermissionArguments(args),
  };
}

export function normalizePermissionArguments(args: unknown): string {
  return stableStringify(args);
}

export function toolKey(
  context: PermissionDecisionContext,
  toolName: string,
  args: unknown,
  serverId?: string,
): string {
  return permissionKey(toolRule(context, toolName, args, serverId));
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(",")}}`;
}

export function resolveToolAction(opts: {
  mode: AIPermissionMode;
  floorBlocked: boolean;
  cached?: CachedVerdict;
  // True when the current turn has already ingested untrusted external content (a tool result, file contents,
  // web-search output). Set by the engine's turn loop.
  tainted?: boolean;
}): ToolAction {
  // Always allow: run everything, ignoring the floor and the cache (the user's explicit max-trust choice).
  if (opts.mode === "allow") {
    return "run";
  }
  // Floor wins in ask + remember — a catastrophic command can never be asked-for or cached-allowed here.
  if (opts.floorBlocked) {
    return "reject";
  }
  // Always ask: prompt for everything; the cache is not consulted.
  if (opts.mode === "ask") {
    return "ask";
  }
  // Ask, approve or reject: honor a prior decision, otherwise ask (the caller persists the new verdict).
  if (opts.cached === "allow") {
    // INJECTION RESISTANCE: a remembered allow is NOT honored once this turn has read untrusted content. The
    // model may be repeating an attacker's instruction found in a file or tool result, so the user is asked
    // again even though they approved this exact call before. Only gated (mutating) tools reach here.
    return opts.tainted ? "ask" : "run";
  }
  if (opts.cached === "block") {
    return "reject";
  }
  return "ask";
}

// Permission cache (the user-managed allow/reject record). Storage is application-owned, but every decision is
// scoped to one workspace, target, authority subject, typed operation, normalized arguments, and trust epoch.
export const AI_PERMISSIONS_VERSION = "2.0.0";

export type PermissionRule = z.infer<typeof permissionRule>;
export type PermissionsSnapshot = z.infer<typeof permissionsSnapshot>;
export type AIPermissionsCache = Pick<PermissionsSnapshot, "version" | "allowed" | "blocked">;

export function emptyPermissionsCache(): AIPermissionsCache {
  return { version: AI_PERMISSIONS_VERSION, allowed: [], blocked: [] };
}

// The remembered verdict for a command key. Block wins over allow (a deny is never overridden by an allow).
export function cachedVerdict(cache: Pick<AIPermissionsCache, "allowed" | "blocked">, key: string): CachedVerdict {
  if (cache.blocked.some((rule) => permissionKey(rule) === key)) {
    return "block";
  }
  if (cache.allowed.some((rule) => permissionKey(rule) === key)) {
    return "allow";
  }
  return undefined;
}

// Permission store PORT
// The capability the broker depends on; implemented by runtimes/permissionsStoreCore over the FS port.
// Read is FAIL-CLOSED — a corrupt/unreadable file surfaces status:"error" with an empty cache so the
// broker can force "ask" rather than silently dropping the user's blocked rules.
export type PermissionsLoadStatus = PermissionsSnapshot["status"];
export type PermissionsList = z.infer<typeof permissionsList>;

export interface PermissionsStoreLike {
  load(): Promise<PermissionsSnapshot>;
  addCommand(list: PermissionsList, rule: PermissionRule): Promise<PermissionsSnapshot>;
  removeCommand(list: PermissionsList, key: string): Promise<PermissionsSnapshot>;
}
