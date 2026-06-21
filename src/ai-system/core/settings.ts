// ── AI subsystem core settings ──────────────────────────────────
// OWNED by core. Imports deepmerge directly (no @/utils → avoids the env/Types cycle).
// The original @/utils.deepMerge wraps the same npm package with arrayMerge +
// isMergeableObject; here we use a minimal equivalent config.

import merge from "deepmerge";

import { PROVIDER_CATALOG } from "./providers";
import type { AIProviderSettings, AISettings } from "./types";

function isMergeableObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepMerge<T>(...sources: Partial<T>[]): T {
  return merge.all<T>(sources, { arrayMerge: (_: unknown, source: unknown[]) => source, isMergeableObject }) as T;
}

// Built from the ONE provider catalog (providers.ts) so settings, resolveProvider, AISettingsForm and
// the model picker never drift. Each provider starts model-less; local servers + clouds carry their
// catalog defaultBaseURL (the public API root for clouds — @ai-sdk/openai-compatible appends
// /chat/completions) and its default auth scheme (none for local, bearer for cloud). Order follows the
// catalog (LM Studio first). deepMerge then lets older configs inherit a newly-added scheme while a user's
// explicit `auth` overrides it cleanly.
function buildDefaultProviders(): Record<string, AIProviderSettings> {
  const providers: Record<string, AIProviderSettings> = {};
  for (const entry of PROVIDER_CATALOG) {
    providers[entry.id] = {
      model: "",
      ...(entry.defaultBaseURL ? { baseURL: entry.defaultBaseURL } : {}),
      auth: { scheme: entry.defaultAuthScheme },
    };
  }
  return providers;
}

// Local-first, safe-by-default. AI is always on; the default provider is a loopback local server so
// nothing leaves the machine until the user picks a cloud provider and saves its key. Web search
// (agent-only) is opt-in OFF. Keep this in sync with the AISettings type.
export const DEFAULT_AI_SETTINGS: AISettings = {
  // LM Studio is the default: its server lists every local model and hot-loads any on request.
  defaultProvider: "lmstudio",
  webSearch: false,
  providers: buildDefaultProviders(),
  // Safest gate by default: prompt on every tool call until the user opts into remembering or full access.
  permissionMode: "ask",
};

// Fill an arbitrary (possibly absent or partial / older-config) ai section with safe defaults.
// deepMerge clones into a fresh object, so DEFAULT_AI_SETTINGS is never mutated and unknown
// providers supplied by the user are preserved for forward compatibility.
export function normalizeAISettings(raw?: Partial<AISettings>): AISettings {
  return deepMerge<AISettings>({}, DEFAULT_AI_SETTINGS, (raw ?? {}) as Partial<AISettings>);
}
