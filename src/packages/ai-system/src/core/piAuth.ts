// Whether a provider can be signed into from here, and what the sign-in's product is stored as.
//
// The app holds ONE credential per provider in the OS keychain. A permanent key is stored as itself; an expiring pair
// is stored whole — access, refresh and expiry — because the refresh token is what keeps the credential alive. The
// exchange runs where the sign-in ran: pi's own flow, in the one-shot auth container, since that code cannot load in
// a web view. So an expiring token is no longer a reason to refuse a login; a credential that CANNOT be rotated is.

import { piProviderIdFor } from "@/pi-bridge/modelBaseline";
import { piProvider } from "@/pi-bridge/piProviderCatalogue";
import type { PiOAuthCredential } from "@/pi-bridge/protocol";

import type { ProviderCredential } from "@/pi-bridge/providerCredential";

// There is no list of who can be signed into any more: pi's own catalogue says which providers carry a flow, and the
// app can now keep either shape one returns — OpenRouter's permanent key (`refresh: ""`,
// `expires: Number.MAX_SAFE_INTEGER`) and the access/refresh pairs anthropic, openai-codex, github-copilot,
// kimi-coding, xai and radius return. `loginCredentialVerdict` decides which shape actually came back, so a flow that
// changes shape is caught rather than trusted.

export interface ProviderLoginOffer {
  // The app's provider id — the keychain account and the settings key.
  providerId: string;
  // pi's own words for the sign-in ("Sign in with OpenRouter"), never ours for someone else's login.
  label: string;
}

// What to offer for a provider, or nothing: pi carries the flow, and pi names it. The selector label when the flow
// declares one, otherwise pi's name for the auth method — both are pi's own words, which is the whole rule.
export function providerLoginOffer(providerId: string): ProviderLoginOffer | undefined {
  const pi = piProvider(piProviderIdFor(providerId));
  if (!pi?.oauth) return undefined;
  const label = pi.oauthLabel ?? pi.oauthName;
  if (!label) return undefined;
  return { providerId, label };
}

export type LoginCredentialVerdict =
  | { storable: true; credential: ProviderCredential }
  | { storable: false; reason: string };

// An expiry this far out is a statement of "never" rather than a deadline — what OpenRouter's permanent key carries.
const PERMANENT_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;

export function loginCredentialVerdict(credential: PiOAuthCredential, now: number): LoginCredentialVerdict {
  if (!credential.access.trim()) {
    return { storable: false, reason: "the sign-in returned no credential" };
  }
  if (credential.expires - now >= PERMANENT_EXPIRY_MS) {
    return { storable: true, credential: { kind: "key", secret: credential.access } };
  }
  if (credential.expires <= now) {
    return { storable: false, reason: "the sign-in returned a credential that had already expired" };
  }
  if (!credential.refresh.trim()) {
    return {
      storable: false,
      reason: "this sign-in returns a token that expires with nothing to renew it, so it cannot be kept",
    };
  }
  return { storable: true, credential: { kind: "oauth", credential } };
}
