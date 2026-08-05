// Every provider pi ships, as the app's picker needs to show one: its id, the name pi calls it, how many models
// it publishes, and which logins it accepts.
//
// Read from pi, never restated. `builtinProviders()` constructs all 38 and each one answers for itself, so there
// is no hand-written table here to drift from pi's own list the way `provider-catalog.json` would.
//
// This is the one place that pays for the whole generated catalogue: `providers/all` reaches every
// `providers/data/*.json`, which is the point — a provider cannot be browsed from a catalogue that was not
// loaded. `modelBaseline` reads its five through this same module rather than importing them twice.

import type { Api, Model } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";

export interface PiProvider {
  id: string;
  // pi's own display name ("Z.AI", "Amazon Bedrock") — never our words for its provider.
  name: string;
  // The endpoint pi points this provider at, when it names one. Ours goes through the gateway either way; this is
  // what a settings entry starts from when a provider is adopted.
  baseUrl?: string;
  // What pi's provider definition accepts. `oauth` here means pi carries a flow for it — running that flow needs a
  // Node realm, so the app cannot offer it from the web view (see the OAuth deferral).
  apiKey: boolean;
  oauth: boolean;
  models: readonly Model<Api>[];
}

// Constructed once. Each factory is a plain object build over already-imported data — no network, no node.
const PI_PROVIDERS: readonly PiProvider[] = builtinProviders()
  .map((provider) => ({
    id: provider.id,
    name: provider.name,
    ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
    apiKey: !!provider.auth?.apiKey,
    oauth: !!provider.auth?.oauth,
    models: safeModels(provider),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

// `Provider.getModels()` is documented as never throwing, and `Models` treats a throwing one as having no models.
// Same reading here rather than trusting the contract with the whole picker.
function safeModels(provider: { getModels: () => readonly Model<Api>[] }): readonly Model<Api>[] {
  try {
    return provider.getModels();
  } catch {
    return [];
  }
}

const BY_ID = new Map(PI_PROVIDERS.map((provider) => [provider.id, provider]));

export function piProviders(): readonly PiProvider[] {
  return PI_PROVIDERS;
}

export function piProvider(id: string): PiProvider | undefined {
  return BY_ID.get(id);
}

// A provider pi publishes nothing for is not worth a row: `radius` is purely dynamic and its catalogue is empty
// until a gateway answers, so browsing it offline would show an empty panel.
export function piBrowsableProviders(): readonly PiProvider[] {
  return PI_PROVIDERS.filter((provider) => provider.models.length > 0);
}
