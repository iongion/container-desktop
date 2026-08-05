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
  // What pi's provider definition accepts. `oauth` means pi carries a login flow for it; the flow itself only runs in
  // a Node realm, which is why signing in happens in a one-shot login container rather than in the web view.
  apiKey: boolean;
  oauth: boolean;
  // pi's own words for the sign-in — "Sign in with OpenRouter". Readable WITHOUT loading the flow, because
  // `lazyOAuth` keeps the name and the label on the wrapper and defers only the Node-only implementation. So the
  // button wears pi's label and this app invents no copy for someone else's login.
  oauthLabel?: string;
  // pi's name for the auth METHOD — "Anthropic (Claude Pro/Max)". Only three of pi's flows declare a `loginLabel`;
  // every one names itself, so this is what a button says when there is no selector label, and the app still never
  // invents copy for someone else's login.
  oauthName?: string;
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
    ...(provider.auth?.oauth?.loginLabel ? { oauthLabel: provider.auth.oauth.loginLabel } : {}),
    ...(provider.auth?.oauth?.name ? { oauthName: provider.auth.oauth.name } : {}),
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
