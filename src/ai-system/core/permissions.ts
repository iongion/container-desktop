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
export type AIPermissionMode = "ask" | "remember" | "allow";

export type ToolAction = "run" | "ask" | "reject";

// The remembered verdict for a command/web-search capability, persisted in the permissions cache.
export type CachedVerdict = "allow" | "block" | undefined;

// The single canonical key for a command — used identically by the broker approval map, the permissions
// cache, and the settings UI so they can never drift. Matches the broker's historical approvalKey shape.
export function commandKey(program: string, args: string[]): string {
  return JSON.stringify([program, args]);
}

// The persisted permission rule for a TYPED first-class tool call (e.g. removeContainer{id}) — a regular
// command rule under a `tool:` prefix with the args stable-stringified into a single token. Reusing the
// command-rule shape keeps the broker approval map, the cache, persistVerdict, and the settings UI all
// single-sourced; `toolKey` is just this rule's commandKey, so cacheLookup(toolKey(...)) finds it.
export function toolRule(toolName: string, args: unknown): AICommandRule {
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
    return "run";
  }
  if (opts.cached === "block") {
    return "reject";
  }
  return "ask";
}

// Permission cache (the user-managed allow/reject record)
// A dedicated, app-global, versioned file in user-data (see runtimes/node/permissionsStore). Commands are
// keyed by exact program+args; the internet (web search) is a single switch since queries vary.
export const AI_PERMISSIONS_VERSION = "1.0.0";

export interface AICommandRule {
  program: string;
  args: string[];
  addedAt?: string;
}

export interface AIPermissionsCache {
  version: string;
  allowed: AICommandRule[];
  blocked: AICommandRule[];
  webSearch?: "allow" | "block";
}

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
// The capability the broker depends on; implemented by runtimes/node/permissionsStore against a file.
// Read is FAIL-CLOSED — a corrupt/unreadable file surfaces status:"error" with an empty cache so the
// broker can force "ask" rather than silently dropping the user's blocked rules.
export type PermissionsLoadStatus = "ok" | "missing" | "error";
export type PermissionsList = "allowed" | "blocked";

export interface PermissionsSnapshot extends AIPermissionsCache {
  status: PermissionsLoadStatus;
  path: string;
}

export interface PermissionsStoreLike {
  load(): Promise<PermissionsSnapshot>;
  addCommand(list: PermissionsList, rule: AICommandRule): Promise<PermissionsSnapshot>;
  removeCommand(list: PermissionsList, key: string): Promise<PermissionsSnapshot>;
  setWebSearch(verdict: "allow" | "block" | undefined): Promise<PermissionsSnapshot>;
}
