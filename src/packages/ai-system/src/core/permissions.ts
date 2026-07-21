// AI permission policy
// OWNED by core. Pure decision logic — no node:/Electron/React. The user picks a global mode; the agent
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

// A WORKER's tool policy, chosen per worker definition in the library and authoritative for that worker's tasks:
//
//   "all"      — every tool the worker holds runs unattended.
//   "ask"      — every tool the worker holds prompts, INCLUDING ungated reads. The only way to say "show me
//                everything this agent reads"; ungated reads are the primary prompt-injection intake and are
//                otherwise never gated in any mode.
//   "granular" — the worker's toolset is narrowed to its allowlist (see filterToolset); whatever survives is
//                then decided by the app's global mode exactly as today.
export type WorkerToolPolicyMode = "all" | "ask" | "granular";

export type ToolAction = "run" | "ask" | "reject";

// The remembered verdict for a command/web-search capability, persisted in the permissions cache.
export type CachedVerdict = "allow" | "block" | undefined;

export function commandKey(program: string, args: string[]): string {
  return JSON.stringify([program, args]);
}

// The persisted permission rule for a TYPED first-class tool call (e.g. removeContainer{id}) — a regular
// command rule under a `tool:` prefix with the args stable-stringified into a single token. Reusing the
// command-rule shape keeps the broker approval map, the cache, persistVerdict, and the settings UI all
// single-sourced; `toolKey` is just this rule's commandKey, so cacheLookup(toolKey(...)) finds it.
export function toolRule(toolName: string, args: unknown): PermissionRule {
  return { program: `tool:${toolName}`, args: [stableStringify(args)] };
}

export function toolKey(toolName: string, args: unknown): string {
  const rule = toolRule(toolName, args);
  return commandKey(rule.program, rule.args);
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

// Decide one tool call made by a task bound to a WORKER from the library. The worker's policy is authoritative
// over the app's global mode — both are user-authored settings at the same trust level, and a roster that could
// only tighten would make "all allowed" appear broken under the default global "ask". Two things it may never do:
// bypass the catastrophic floor, or overturn an explicit remembered block.
export function resolveWorkerToolAction(opts: {
  policy: WorkerToolPolicyMode;
  // The app-global mode, still the authority for a "granular" worker's surviving tools.
  runMode: AIPermissionMode;
  floorBlocked: boolean;
  cached?: CachedVerdict;
  tainted?: boolean;
}): ToolAction {
  // Unlike the global "allow" mode — which predates workers and is the user's explicit max-trust switch for
  // commands they typed themselves — a worker definition is reusable and may be authored once and forgotten.
  if (opts.floorBlocked) {
    return "reject";
  }
  // A remembered block is the user's standing "never" for this exact call; a policy widens what runs unattended,
  // it does not repeal a deny.
  if (opts.cached === "block") {
    return "reject";
  }
  if (opts.policy === "all") {
    return "run";
  }
  // Gate everything the worker holds. A remembered allow must not satisfy this: the user asked to see each call.
  if (opts.policy === "ask") {
    return "ask";
  }
  // Granular: the toolset was already narrowed to the allowlist, so what reaches here is decided exactly as any
  // ordinary call is — including the injection-taint rule on a remembered allow.
  return resolveToolAction({
    mode: opts.runMode,
    floorBlocked: false,
    cached: opts.cached,
    tainted: opts.tainted,
  });
}

// Permission cache (the user-managed allow/reject record)
// A dedicated, app-global, versioned file in user-data (see runtimes/permissionsStoreCore). Commands are
// keyed by exact program+args; the internet (web search) is a single switch since queries vary.
export const AI_PERMISSIONS_VERSION = "1.0.0";

export type PermissionRule = z.infer<typeof permissionRule>;
export type PermissionsSnapshot = z.infer<typeof permissionsSnapshot>;
export type AIPermissionsCache = Pick<PermissionsSnapshot, "version" | "allowed" | "blocked" | "webSearch">;

export function emptyPermissionsCache(): AIPermissionsCache {
  return { version: AI_PERMISSIONS_VERSION, allowed: [], blocked: [] };
}

// The remembered verdict for a command key. Block wins over allow (a deny is never overridden by an allow).
export function cachedVerdict(cache: Pick<AIPermissionsCache, "allowed" | "blocked">, key: string): CachedVerdict {
  if (cache.blocked.some((r) => commandKey(r.program, r.args) === key)) {
    return "block";
  }
  if (cache.allowed.some((r) => commandKey(r.program, r.args) === key)) {
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
  setWebSearch(verdict: "allow" | "block" | undefined): Promise<PermissionsSnapshot>;
}
