// Pure provider resolution (no AI-SDK import, so it stays unit-testable). Decides which provider,
// base URL, model, and whether a key is required. The actual AI-SDK LanguageModel is built from
// this by createLanguageModel() in the runtime layer. See.

import i18n from "@/i18n";
import type { AIAuthScheme, AIAuthSettings, AISettings } from "./types";

// "local" and "openai-compatible" both build via @ai-sdk/openai-compatible; the difference is reach:
// "local" is an on-device loopback server (keyless), "openai-compatible" is a remote cloud (key-requiring,
// egress-gated). "anthropic"/"openai" use their dedicated AI-SDK providers.
export type ProviderKind = "local" | "anthropic" | "openai" | "openai-compatible";

// How the picker enumerates a source's models:
//   "list"   — the server reports a list (LM Studio's loaded models, a cloud's /v1/models, OpenRouter's catalog)
//   "single" — exactly one served model bound at launch and unswitchable at runtime (llama.cpp `-m`)
//   "none"   — not discoverable (reserved; nothing uses it yet)
export type ProviderDiscovery = "list" | "single" | "none";

// ONE source of truth for provider metadata. settings.ts builds DEFAULT_AI_SETTINGS.providers
// from this, resolveProvider() derives kind/baseURL/requiresKey from it, and the renderer (ModelPicker +
// AISettingsForm) reads it for ordering/labels — instead of three drifting copies. Presentation-only data
// (Blueprint icons) stays in the renderer; this stays React/Electron-free so core purity holds.
export interface ProviderCatalogEntry {
  id: string;
  label: string;
  kind: ProviderKind;
  /** Off-device by nature (cloud API). Local servers pointed at a remote host are gated separately via egress. */
  cloud: boolean;
  /** A gateway whose /v1/models returns vendor-prefixed ids ("anthropic/claude-3.5-sonnet") → 3-level picker. */
  aggregator: boolean;
  discovery: ProviderDiscovery;
  /** Loopback URL for local servers, public API root for clouds. */
  defaultBaseURL?: string;
  /** Default connection auth scheme — the one seeded into settings. Must be a member of `authSchemes`. */
  defaultAuthScheme: AIAuthScheme;
  /** Capability: the auth schemes this provider supports — exactly what the UI offers. Clouds are API-key
   * (`["bearer"]`); locals are keyless or an optional API key (`["none","bearer"]`). HTTP Basic / custom
   * header are reserved for unknown user-added gateways (no catalog provider uses them). */
  authSchemes: AIAuthScheme[];
  /** Picker sort weight — lower sorts first within its section; ties break alphabetically by label.
   * Pins LM Studio (the local default) and OpenRouter (the recommended aggregator) ahead of their peers. */
  weight?: number;
}

export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  // LM Studio first — the default. Its server lists every local model and hot-loads any on request.
  {
    id: "lmstudio",
    label: i18n.t("LM Studio"),
    kind: "local",
    cloud: false,
    aggregator: false,
    discovery: "list",
    defaultBaseURL: "http://127.0.0.1:1234/v1",
    defaultAuthScheme: "none",
    authSchemes: ["none", "bearer"],
    weight: -1,
  },
  // llama.cpp binds ONE model at launch via `-m` and can't switch at runtime → single read-only model.
  {
    id: "llamacpp",
    label: i18n.t("llama.cpp"),
    kind: "local",
    cloud: false,
    aggregator: false,
    discovery: "single",
    defaultBaseURL: "http://127.0.0.1:8080/v1",
    defaultAuthScheme: "none",
    authSchemes: ["none", "bearer"],
  },
  {
    id: "anthropic",
    label: i18n.t("Anthropic"),
    kind: "anthropic",
    cloud: true,
    aggregator: false,
    discovery: "list",
    defaultBaseURL: "https://api.anthropic.com/v1",
    defaultAuthScheme: "bearer",
    authSchemes: ["bearer"],
  },
  {
    id: "openai",
    label: i18n.t("OpenAI"),
    kind: "openai",
    cloud: true,
    aggregator: false,
    discovery: "list",
    defaultBaseURL: "https://api.openai.com/v1",
    defaultAuthScheme: "bearer",
    authSchemes: ["bearer"],
  },
  {
    id: "deepseek",
    label: i18n.t("DeepSeek"),
    kind: "openai-compatible",
    cloud: true,
    aggregator: false,
    discovery: "list",
    defaultBaseURL: "https://api.deepseek.com/v1",
    defaultAuthScheme: "bearer",
    authSchemes: ["bearer"],
  },
  {
    id: "glm",
    label: i18n.t("GLM (Zhipu)"),
    kind: "openai-compatible",
    cloud: true,
    aggregator: false,
    discovery: "list",
    defaultBaseURL: "https://open.bigmodel.cn/api/paas/v4",
    defaultAuthScheme: "bearer",
    authSchemes: ["bearer"],
  },
  {
    id: "minimax",
    label: i18n.t("MiniMax"),
    kind: "openai-compatible",
    cloud: true,
    aggregator: false,
    discovery: "list",
    defaultBaseURL: "https://api.minimax.chat/v1",
    defaultAuthScheme: "bearer",
    authSchemes: ["bearer"],
  },
  // OpenRouter last — an aggregator/proxy in front of many of the others; its ids are vendor-prefixed.
  {
    id: "openrouter",
    label: i18n.t("OpenRouter"),
    kind: "openai-compatible",
    cloud: true,
    aggregator: true,
    discovery: "list",
    defaultBaseURL: "https://openrouter.ai/api/v1",
    defaultAuthScheme: "bearer",
    authSchemes: ["bearer"],
    weight: -1,
  },
];

const CATALOG_BY_ID: Record<string, ProviderCatalogEntry> = Object.fromEntries(
  PROVIDER_CATALOG.map((entry) => [entry.id, entry]),
);

export function getProviderEntry(id: string): ProviderCatalogEntry | undefined {
  return CATALOG_BY_ID[id];
}

// Picker list ordering: lower `weight` first, ties alphabetical by label. The catalog pins entries
// declaratively (LM Studio / OpenRouter weight -1) instead of any hardcoded id check at the call site.
export function compareProviderEntries(a: ProviderCatalogEntry, b: ProviderCatalogEntry): number {
  return (a.weight ?? 0) - (b.weight ?? 0) || a.label.localeCompare(b.label);
}

// An aggregator (e.g. OpenRouter) needs the extra gateway→upstream-provider→model level. Derived from the
// catalog so there is no second list to keep in sync; extend by flipping `aggregator` on a catalog entry.
export function isAggregatorProvider(id: string): boolean {
  return CATALOG_BY_ID[id]?.aggregator ?? false;
}

// The auth schemes to OFFER in the UI for a provider = its declared capability (`entry.authSchemes`). An
// unknown/user-added provider (no catalog entry) can be anything, so it gets the full set (incl. Basic /
// custom header for an exotic gateway).
export function authSchemesFor(entry?: ProviderCatalogEntry): AIAuthScheme[] {
  return entry?.authSchemes ?? ["none", "bearer", "basic", "header"];
}

// Split a (possibly) vendor-prefixed model id on its FIRST slash: "anthropic/claude-3.5-sonnet" →
// { provider: "anthropic", model: "claude-3.5-sonnet" }. A flat id (no slash) has no provider prefix.
// Only meaningful for aggregator sources — for flat sources a "/" is just an HF org and must NOT be split.
export function parseAggregatedModelId(id: string): { provider: string; model: string } {
  const raw = (id ?? "").trim();
  const slash = raw.indexOf("/");
  if (slash === -1) {
    return { provider: "", model: raw };
  }
  return { provider: raw.slice(0, slash), model: raw.slice(slash + 1) };
}

export interface ResolvedProvider {
  id: string;
  kind: ProviderKind;
  baseURL: string;
  model: string;
  isCloud: boolean;
  requiresKey: boolean;
  /** Resolved connection auth — the catalog default scheme unless the user overrode it per provider. */
  auth: AIAuthSettings;
}

// Derived from the catalog (single source). Unknown/user-added providers fall back to a keyless local
// OpenAI-compatible server.
const KIND_BY_ID: Record<string, ProviderKind> = Object.fromEntries(PROVIDER_CATALOG.map((e) => [e.id, e.kind]));
const DEFAULT_BASEURL_BY_ID: Record<string, string> = Object.fromEntries(
  PROVIDER_CATALOG.filter((e) => e.defaultBaseURL).map((e) => [e.id, e.defaultBaseURL as string]),
);
const DEFAULT_AUTH_SCHEME_BY_ID: Record<string, AIAuthScheme> = Object.fromEntries(
  PROVIDER_CATALOG.map((e) => [e.id, e.defaultAuthScheme]),
);

export function resolveProvider(settings: AISettings, providerId?: string): ResolvedProvider {
  const id = providerId || settings.defaultProvider;
  const cfg = settings.providers?.[id];
  if (!cfg) {
    throw new Error(`Unknown AI provider: ${id}`);
  }
  const kind: ProviderKind = KIND_BY_ID[id] ?? "local";
  const isCloud = kind !== "local";
  const baseURL = cfg.baseURL || DEFAULT_BASEURL_BY_ID[id] || "";
  // The user's per-provider override wins; else the catalog default (unknown/user-added providers → "none",
  // i.e. keyless local). requiresKey derives from the SCHEME, not isCloud — so a hardened local can
  // require a key and a cloud set to "none" stays browsable keyless.
  const auth = cfg.auth ?? { scheme: DEFAULT_AUTH_SCHEME_BY_ID[id] ?? "none" };
  return { id, kind, baseURL, model: cfg.model, isCloud, requiresKey: auth.scheme !== "none", auth };
}
