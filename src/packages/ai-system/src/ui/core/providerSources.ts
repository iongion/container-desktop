// The rows the picker's root panel shows: the sources this app is configured for, then everything else pi ships.
//
// Two lists meet here. `provider-catalog.json` owns what the app can CONNECT to — the endpoint, the auth schemes,
// whether discovery is a listing or a single served model — and it owns the two local servers pi has never heard of.
// pi's catalogue owns BREADTH: 37 providers with per-model data, none of which the app had to write down.
//
// A pi provider we already ship keeps our entry (it is the one with connection facts); the rest become rows the user
// can browse and then adopt. Nothing here fetches: a count and a name come from data already in the bundle.

import {
  compareProviderEntries,
  getProviderEntry,
  PROVIDER_CATALOG,
  type ProviderCatalogEntry,
} from "@/ai-system/core/providers";
import type { AISettings } from "@/ai-system/core/types";
import { piProviderIdFor } from "@/pi-bridge/modelBaseline";
import { piBrowsableProviders, piProvider } from "@/pi-bridge/piProviderCatalogue";

export interface ProviderSource {
  id: string;
  // For a source the app ships this is its catalogue label key, which the UI puts through `t()`. For a pi-only one
  // it is pi's own name, which is not ours to translate.
  label: string;
  translate: boolean;
  local: boolean;
  // Configured = the app has a provider entry for it, so a session can be started on it today.
  configured: boolean;
  // How many models pi publishes for it, when pi carries it. Absent for a source only its own server can list.
  published?: number;
  // pi carries a login flow for it. The app cannot run one from the web view, so this is shown, not offered.
  oauth?: boolean;
}

export interface ProviderSourceGroups {
  local: ProviderSource[];
  configured: ProviderSource[];
  // Everything pi ships that the app has no entry for — the breadth, kept behind its own heading so the sources in
  // daily use stay at the top.
  more: ProviderSource[];
}

function publishedCount(providerId: string): number | undefined {
  const pi = piBrowsableProviders().find((provider) => provider.id === piProviderIdFor(providerId));
  return pi ? pi.models.length : undefined;
}

// An app source: our label and our connection facts, plus pi's model count where pi knows the provider.
function appSource(id: string, settings: AISettings): ProviderSource {
  const entry = getProviderEntry(id);
  const published = publishedCount(id);
  return {
    id,
    label: entry?.labelKey ?? id,
    translate: true,
    local: !entry?.cloud,
    configured: !!settings.providers?.[id],
    ...(published === undefined ? {} : { published }),
  };
}

export function providerSources(settings: AISettings, query = ""): ProviderSourceGroups {
  const q = query.trim().toLowerCase();
  const ours = new Set<string>();
  const local: ProviderSource[] = [];
  const configured: ProviderSource[] = [];

  for (const entry of [...PROVIDER_CATALOG].sort(compareProviderEntries)) {
    ours.add(piProviderIdFor(entry.id));
    ours.add(entry.id);
    const source = appSource(entry.id, settings);
    (source.local ? local : configured).push(source);
  }

  // A provider ADOPTED from pi's catalogue has a settings entry and no catalogue row. It belongs with the
  // configured ones — it is connectable now, and Settings has to list it or its key could never be edited.
  for (const id of Object.keys(settings.providers ?? {})) {
    if (ours.has(id)) continue;
    const pi = piProvider(piProviderIdFor(id));
    ours.add(id);
    configured.push({
      id,
      label: pi?.name ?? id,
      translate: false,
      local: false,
      configured: true,
      ...(pi ? { published: pi.models.length } : {}),
      ...(pi?.oauth ? { oauth: true } : {}),
    });
  }

  const more = piBrowsableProviders()
    .filter((provider) => !ours.has(provider.id))
    .map((provider) => ({
      id: provider.id,
      label: provider.name,
      translate: false,
      local: false,
      configured: false,
      published: provider.models.length,
      ...(provider.oauth ? { oauth: true } : {}),
    }));

  // The filter runs on what the row actually shows, after the groups are built, so a search never reorders them.
  const matching = (sources: ProviderSource[]) =>
    q ? sources.filter((source) => source.label.toLowerCase().includes(q) || source.id.includes(q)) : sources;

  return { local: matching(local), configured: matching(configured), more: matching(more) };
}

// A pi-only provider as a catalogue entry, so every consumer that resolves one — the picker's panels, the tree
// builder, the settings form once it is adopted — sees the same shape it always has.
//
// Every field is READ off pi's own definition, never invented: the wire kind and the discovery style come from the
// api its models declare, and the extra vendor→model level comes from its ids actually carrying a slash (which is
// what makes OpenRouter an aggregator and DeepSeek not one). Only what pi does not express at all — that a cloud
// endpoint takes a bearer token — is a constant, and it is the one every keyed provider here already uses.
export function piCatalogEntry(providerId: string): ProviderCatalogEntry | undefined {
  const pi = piProvider(piProviderIdFor(providerId));
  if (!pi || pi.models.length === 0) return undefined;
  const anthropicWire = pi.models.every((model) => model.api === "anthropic-messages");
  return {
    id: pi.id,
    labelKey: pi.name,
    kind: anthropicWire ? "anthropic" : "openai-compatible",
    cloud: true,
    aggregator: pi.models.some((model) => model.id.includes("/")),
    discovery: anthropicWire ? "anthropic" : "openai-compatible",
    ...(pi.baseUrl ? { defaultBaseURL: pi.baseUrl } : {}),
    defaultAuthScheme: pi.apiKey ? "bearer" : "none",
    authSchemes: pi.apiKey ? ["bearer"] : ["none"],
  };
}

// The entry for any source id, ours or pi's — what the picker resolves a row through.
export function sourceCatalogEntry(providerId: string): ProviderCatalogEntry | undefined {
  return getProviderEntry(providerId) ?? piCatalogEntry(providerId);
}
