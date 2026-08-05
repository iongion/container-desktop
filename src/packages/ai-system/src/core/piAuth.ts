// Whether a provider can be signed into from here, and whether what its sign-in returned can be kept.
//
// The app holds ONE static secret per provider, read out of the OS keychain and handed to the gateway container as an
// env file. That is the whole of its credential machinery, and it decides what a login may produce: a permanent key
// can be stored, an expiring token cannot — nothing in this app can exchange a refresh token, and a session whose
// credential dies mid-turn is worse than a sign-in that was never offered.

import { piProviderIdFor } from "@/pi-bridge/modelBaseline";
import { piProvider } from "@/pi-bridge/piProviderCatalogue";
import type { PiOAuthCredential } from "@/pi-bridge/protocol";

// The providers whose login ENDS in a durable key rather than a session token. Read off pi's own flows:
// `auth/oauth/openrouter.ts` exchanges its authorization code for a permanent, user-controlled API key and returns
// `refresh: ""` with `expires: Number.MAX_SAFE_INTEGER`, while anthropic, openai-codex, github-copilot, kimi-coding,
// xai and radius each return `refresh: <token>` and an `expires` minutes or hours out, and declare a `refresh()` the
// gateway has no way to call. This list is the OFFER; `loginCredentialVerdict` is the guard — so if a flow ever
// changes shape the user is told, not handed a credential that stops working.
export const PROVIDER_LOGIN_KEEPS_A_KEY: readonly string[] = ["openrouter"];

// A credential is durable when nothing has to be exchanged for it later: no refresh token, and an expiry so far out
// that it is a statement of "never" rather than a deadline. Every expiring token pi returns lands inside a day.
const DURABLE_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;

export interface ProviderLoginOffer {
  // The app's provider id — the keychain account and the settings key.
  providerId: string;
  // pi's own words for the sign-in ("Sign in with OpenRouter"), never ours for someone else's login.
  label: string;
}

// What to offer for a provider, or nothing. Both halves must hold: pi carries the flow (its catalogue says so, and
// its label comes with it), and the credential that flow produces is one this app can keep.
export function providerLoginOffer(providerId: string): ProviderLoginOffer | undefined {
  if (!PROVIDER_LOGIN_KEEPS_A_KEY.includes(providerId)) return undefined;
  const pi = piProvider(piProviderIdFor(providerId));
  if (!pi?.oauth || !pi.oauthLabel) return undefined;
  return { providerId, label: pi.oauthLabel };
}

export type LoginCredentialVerdict = { storable: true; secret: string } | { storable: false; reason: string };

export function loginCredentialVerdict(credential: PiOAuthCredential, now: number): LoginCredentialVerdict {
  if (!credential.access.trim()) {
    return { storable: false, reason: "the sign-in returned no credential" };
  }
  if (credential.refresh) {
    return {
      storable: false,
      reason: "this sign-in returns a token that has to be refreshed, which the assistant cannot do yet",
    };
  }
  if (credential.expires - now < DURABLE_EXPIRY_MS) {
    return { storable: false, reason: "this sign-in returns a token that expires, so it cannot be stored as a key" };
  }
  return { storable: true, secret: credential.access };
}
