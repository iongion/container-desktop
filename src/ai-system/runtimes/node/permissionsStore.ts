// Main-only file backing for the AI permission cache. A dedicated, app-global, versioned
// JSON in userData — the user-managed allow/reject record (commands keyed by exact program+args; web
// search is a single switch). Mirrors credentialsStore/knowledgeFileStorage (node:fs, mkdir + writeFile,
// mode 0600). Read is FAIL-CLOSED: a corrupt/unreadable existing file surfaces status:"error" with an
// empty cache so the broker can force "ask" rather than silently dropping the user's blocked rules.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  AI_PERMISSIONS_VERSION,
  type AICommandRule,
  type AIPermissionsCache,
  commandKey,
  type PermissionsList,
  type PermissionsLoadStatus,
  type PermissionsSnapshot,
  type PermissionsStoreLike,
} from "@/ai-system/core";

// The contract lives in core (PermissionsStoreLike); this is its file-backed implementation.
export type { PermissionsList, PermissionsLoadStatus, PermissionsSnapshot } from "@/ai-system/core";
export type PermissionsStore = PermissionsStoreLike;

function sanitizeRules(value: unknown): AICommandRule[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: AICommandRule[] = [];
  for (const raw of value) {
    if (
      raw &&
      typeof raw === "object" &&
      typeof (raw as any).program === "string" &&
      Array.isArray((raw as any).args)
    ) {
      out.push({
        program: (raw as any).program,
        args: ((raw as any).args as unknown[]).map((a) => String(a)),
        ...(typeof (raw as any).addedAt === "string" ? { addedAt: (raw as any).addedAt } : {}),
      });
    }
  }
  return out;
}

export function createPermissionsStore(filePath: string): PermissionsStore {
  const snap = (status: PermissionsLoadStatus, cache: AIPermissionsCache): PermissionsSnapshot => ({
    ...cache,
    status,
    path: filePath,
  });

  const load = async (): Promise<PermissionsSnapshot> => {
    let text: string;
    try {
      text = await readFile(filePath, "utf8");
    } catch (error: any) {
      // Absent → normal (empty cache). Any other read failure → fail closed.
      const status: PermissionsLoadStatus = error?.code === "ENOENT" ? "missing" : "error";
      return snap(status, { version: AI_PERMISSIONS_VERSION, allowed: [], blocked: [] });
    }
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || parsed.version !== AI_PERMISSIONS_VERSION) {
        return snap("error", { version: AI_PERMISSIONS_VERSION, allowed: [], blocked: [] });
      }
      const webSearch = parsed.webSearch === "allow" || parsed.webSearch === "block" ? parsed.webSearch : undefined;
      return snap("ok", {
        version: AI_PERMISSIONS_VERSION,
        allowed: sanitizeRules(parsed.allowed),
        blocked: sanitizeRules(parsed.blocked),
        ...(webSearch ? { webSearch } : {}),
      });
    } catch {
      return snap("error", { version: AI_PERMISSIONS_VERSION, allowed: [], blocked: [] });
    }
  };

  // Mutations start from the readable state (empty on missing/error — writing recovers a corrupt file,
  // which is the user's explicit management action) and persist a clean v1 cache.
  const persist = async (cache: AIPermissionsCache): Promise<PermissionsSnapshot> => {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(cache, null, 2), { mode: 0o600 });
    return snap("ok", cache);
  };

  const current = async (): Promise<AIPermissionsCache> => {
    const s = await load();
    return {
      version: AI_PERMISSIONS_VERSION,
      allowed: s.allowed,
      blocked: s.blocked,
      ...(s.webSearch ? { webSearch: s.webSearch } : {}),
    };
  };

  return {
    load,
    async addCommand(list, rule) {
      const cache = await current();
      const key = commandKey(rule.program, rule.args);
      const other: PermissionsList = list === "allowed" ? "blocked" : "allowed";
      // Exclusive verdicts: drop the key from the other list, dedupe within the target list, then add.
      cache[other] = cache[other].filter((r) => commandKey(r.program, r.args) !== key);
      cache[list] = cache[list].filter((r) => commandKey(r.program, r.args) !== key);
      cache[list].push({ program: rule.program, args: rule.args, addedAt: new Date().toISOString() });
      return persist(cache);
    },
    async removeCommand(list, key) {
      const cache = await current();
      cache[list] = cache[list].filter((r) => commandKey(r.program, r.args) !== key);
      return persist(cache);
    },
    async setWebSearch(verdict) {
      const cache = await current();
      if (verdict) {
        cache.webSearch = verdict;
      } else {
        cache.webSearch = undefined;
      }
      return persist(cache);
    },
  };
}
