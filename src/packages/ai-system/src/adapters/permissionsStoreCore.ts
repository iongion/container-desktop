// Shell-neutral AI-permissions store — the user-managed allow/reject record (commands keyed by exact
// program+args; web search is a single switch). The only per-runtime concern (reading/writing the JSON file)
// is injected as the app's own IFileSystem + IPath ports, so this module has NO node:*/electron/Buffer
// dependency. createAISystem builds it once over the shell's FS port (Electron main -> platform/electron/host FS/Path;
// Tauri webview → window.FS). Load is FAIL-CLOSED: a corrupt or unreadable EXISTING file surfaces status:"error"
// with an empty
// cache so the broker forces "ask" rather than silently dropping the user's blocked rules; a truly missing file
// is status:"missing".

import PQueue from "p-queue";
import {
  AI_PERMISSIONS_VERSION,
  type AIPermissionsCache,
  commandKey,
  type PermissionRule,
  type PermissionsList,
  type PermissionsLoadStatus,
  type PermissionsSnapshot,
  type PermissionsStoreLike,
} from "@/ai-system/core/permissions";
import type { IFileSystem, IPath } from "@/host-contract/fs";

import { readTextFileOrNull, writePrivateFileViaTempRename } from "./fsHelpers";

function sanitizeRules(value: unknown): PermissionRule[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: PermissionRule[] = [];
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

export function createPermissionsStore(filePath: string, fs: IFileSystem, path: IPath): PermissionsStoreLike {
  const empty = (): AIPermissionsCache => ({ version: AI_PERMISSIONS_VERSION, allowed: [], blocked: [] });
  const snap = (status: PermissionsLoadStatus, cache: AIPermissionsCache): PermissionsSnapshot => ({
    ...cache,
    status,
    path: filePath,
  });

  const read = async (): Promise<{ status: PermissionsLoadStatus; cache: AIPermissionsCache }> => {
    let text: string | null;
    try {
      text = await readTextFileOrNull(fs, filePath);
    } catch {
      return { status: "error", cache: empty() };
    }
    if (text === null) {
      return { status: "missing", cache: empty() };
    }
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || parsed.version !== AI_PERMISSIONS_VERSION) {
        return { status: "error", cache: empty() };
      }
      const webSearch = parsed.webSearch === "allow" || parsed.webSearch === "block" ? parsed.webSearch : undefined;
      return {
        status: "ok",
        cache: {
          version: AI_PERMISSIONS_VERSION,
          allowed: sanitizeRules(parsed.allowed),
          blocked: sanitizeRules(parsed.blocked),
          ...(webSearch ? { webSearch } : {}),
        },
      };
    } catch {
      return { status: "error", cache: empty() };
    }
  };
  let state = read();
  const writes = new PQueue({ concurrency: 1 });

  const load = async (): Promise<PermissionsSnapshot> => {
    const current = await state;
    return snap(current.status, structuredClone(current.cache));
  };

  // Serialise mutations through a concurrency-1 queue (ordered, continue-on-error); each reads the latest
  // `state` at run time so sequential writes compose, same as the old hand-rolled promise chain.
  const mutate = (change: (cache: AIPermissionsCache) => void): Promise<PermissionsSnapshot> =>
    writes.add(async () => {
      const current = await state;
      const candidate = structuredClone(current.cache);
      change(candidate);
      await writePrivateFileViaTempRename(fs, path, filePath, JSON.stringify(candidate, null, 2));
      state = Promise.resolve({ status: "ok", cache: candidate });
      return snap("ok", structuredClone(candidate));
    });

  return {
    load,
    async addCommand(list, rule) {
      return mutate((cache) => {
        const key = commandKey(rule.program, rule.args);
        const other: PermissionsList = list === "allowed" ? "blocked" : "allowed";
        cache[other] = cache[other].filter((r) => commandKey(r.program, r.args) !== key);
        cache[list] = cache[list].filter((r) => commandKey(r.program, r.args) !== key);
        cache[list].push({ program: rule.program, args: rule.args, addedAt: new Date().toISOString() });
      });
    },
    async removeCommand(list, key) {
      return mutate((cache) => {
        cache[list] = cache[list].filter((r) => commandKey(r.program, r.args) !== key);
      });
    },
    async setWebSearch(verdict) {
      return mutate((cache) => {
        if (verdict) cache.webSearch = verdict;
        else cache.webSearch = undefined;
      });
    },
  };
}
