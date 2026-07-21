// Pure provider resolution (no AI-SDK import, so it stays unit-testable). Decides which provider,
// base URL, model, and whether a key is required. The actual AI-SDK LanguageModel is built from
// this by createLanguageModel() in the runtime layer. See.

import { z } from "zod";
import providerCatalog from "@/resources/ai/provider-catalog.json";
import type { AIAuthScheme, AIAuthSettings, AISettings } from "./types";

// "local" and "openai-compatible" both build via @ai-sdk/openai-compatible; the catalog kind describes their
// default connection shape. A user may explicitly point either kind at another HTTP(S) endpoint.
// "anthropic"/"openai" use their dedicated AI-SDK providers.
export type ProviderKind = "local" | "anthropic" | "openai" | "openai-compatible";

// Provider-specific discovery is runtime behavior, not merely a list/single UI hint. Unknown endpoints use the
// explicitly configured model instead of assuming an OpenAI-compatible models endpoint.
export type ProviderDiscovery = "openai-compatible" | "anthropic" | "single" | "manual";

// ONE source of truth for provider metadata. settings.ts builds DEFAULT_AI_SETTINGS.providers
// from this, resolveProvider() derives kind/baseURL/requiresKey from it, and the renderer (ModelPicker +
// AISettingsForm) reads it for ordering/labels — instead of three drifting copies. Presentation-only data
// (Blueprint icons) stays in the renderer; this stays React/Electron-free so core purity holds.
const providerCatalogEntry = z
  .object({
    id: z.string().min(1),
    labelKey: z.string().min(1),
    kind: z.enum(["local", "anthropic", "openai", "openai-compatible"]),
    cloud: z.boolean(),
    aggregator: z.boolean(),
    discovery: z.enum(["openai-compatible", "anthropic", "single", "manual"]),
    defaultBaseURL: z.url().optional(),
    defaultAuthScheme: z.enum(["none", "bearer", "basic", "header"]),
    authSchemes: z.array(z.enum(["none", "bearer", "basic", "header"])).min(1),
    weight: z.number().optional(),
  })
  .strict();

export type ProviderCatalogEntry = z.infer<typeof providerCatalogEntry>;
export const PROVIDER_CATALOG = z.array(providerCatalogEntry).parse(providerCatalog);

const CATALOG_BY_ID: Record<string, ProviderCatalogEntry> = Object.fromEntries(
  PROVIDER_CATALOG.map((entry) => [entry.id, entry]),
);

export function getProviderEntry(id: string): ProviderCatalogEntry | undefined {
  return CATALOG_BY_ID[id];
}

// Picker list ordering: lower `weight` first, ties alphabetical by label key. The catalog pins entries
// declaratively (LM Studio / OpenRouter weight -1) instead of any hardcoded id check at the call site.
export function compareProviderEntries(a: ProviderCatalogEntry, b: ProviderCatalogEntry): number {
  return (a.weight ?? 0) - (b.weight ?? 0) || a.labelKey.localeCompare(b.labelKey);
}

// An aggregator (e.g. OpenRouter) needs the extra gateway→upstream-provider→model level. Derived from the
// catalog so there is no second list to keep in sync; extend by flipping `aggregator` on a catalog entry.
export function isAggregatorProvider(id: string): boolean {
  return CATALOG_BY_ID[id]?.aggregator ?? false;
}

export function isLoopbackProviderHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized) ||
    /^::ffff:127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

// Used only to explain a non-loopback URL in provider settings. Saving that URL is the destination decision;
// this classifier is not a permission gate.
export function isRemoteProviderEndpoint(baseURL: string): boolean {
  try {
    return !isLoopbackProviderHost(new URL(baseURL).hostname);
  } catch {
    return true;
  }
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
  // Resolved connection auth — the catalog default scheme unless the user overrode it per provider.
  auth: AIAuthSettings;
  discovery: ProviderDiscovery;
}

export function resolveProvider(settings: AISettings, providerId?: string): ResolvedProvider {
  const id = providerId || settings.defaultProvider;
  const cfg = settings.providers?.[id];
  if (!cfg) {
    throw new Error(`Unknown AI provider: ${id}`);
  }
  // Everything provider-specific comes from the one CATALOG_BY_ID entry; unknown/user-added providers fall
  // back to a keyless local OpenAI-compatible server.
  const entry = CATALOG_BY_ID[id];
  const kind: ProviderKind = entry?.kind ?? "local";
  const isCloud = kind !== "local";
  const baseURL = cfg.baseURL || entry?.defaultBaseURL || "";
  // The user's per-provider override wins; else the catalog default (unknown/user-added providers → "none",
  // i.e. keyless local). requiresKey derives from the SCHEME, not isCloud — so a hardened local can
  // require a key and a cloud set to "none" stays browsable keyless.
  const auth = cfg.auth ?? { scheme: entry?.defaultAuthScheme ?? "none" };
  return {
    id,
    kind,
    baseURL,
    model: cfg.model,
    isCloud,
    requiresKey: auth.scheme !== "none",
    auth,
    discovery: entry?.discovery ?? "manual",
  };
}
