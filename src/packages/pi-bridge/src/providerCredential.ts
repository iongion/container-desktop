// What one vault entry holds for a provider. It was a bare secret string, and stays one for an API key — a key in the
// keychain today must not change meaning. A sign-in that returns an expiring pair needs all three of its fields kept,
// or the next exchange has nothing to exchange, so those are stored as a tagged one-line envelope instead.
//
// One line matters: the same value is substituted into the gateway's env file, and an env value cannot carry a
// newline.

import type { PiOAuthCredential } from "./protocol";

export type ProviderCredential = { kind: "key"; secret: string } | { kind: "oauth"; credential: PiOAuthCredential };

// The tag. A vault value is only read as a credential envelope when it carries this exact marker, so a user's API key
// that happens to be JSON is still a key.
const ENVELOPE_TAG = "cd-provider-credential";

interface CredentialEnvelope {
  cd: typeof ENVELOPE_TAG;
  access: string;
  refresh: string;
  expires: number;
}

export function encodeProviderCredential(credential: ProviderCredential): string {
  if (credential.kind === "key") return credential.secret;
  const envelope: CredentialEnvelope = {
    cd: ENVELOPE_TAG,
    access: credential.credential.access,
    refresh: credential.credential.refresh,
    expires: credential.credential.expires,
  };
  return JSON.stringify(envelope);
}

function envelopeOf(value: string): CredentialEnvelope | undefined {
  if (!value.startsWith("{")) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const candidate = parsed as Record<string, unknown>;
  if (candidate.cd !== ENVELOPE_TAG) return undefined;
  if (typeof candidate.access !== "string" || typeof candidate.refresh !== "string") return undefined;
  if (typeof candidate.expires !== "number") return undefined;
  return { cd: ENVELOPE_TAG, access: candidate.access, refresh: candidate.refresh, expires: candidate.expires };
}

export function decodeProviderCredential(value: string | undefined): ProviderCredential | undefined {
  if (!value) return undefined;
  const envelope = envelopeOf(value);
  if (!envelope) return { kind: "key", secret: value };
  return {
    kind: "oauth",
    credential: { access: envelope.access, refresh: envelope.refresh, expires: envelope.expires },
  };
}

// What signs a request upstream. Never the refresh token: that is only ever sent to the provider's token endpoint,
// by pi's own flow, inside the one-shot auth container.
export function upstreamSecretOf(credential: ProviderCredential): string {
  return credential.kind === "key" ? credential.secret : credential.credential.access;
}

// Rotate BEFORE the deadline, not on it. A turn that starts on a token with seconds left dies mid-answer, which is
// exactly the failure the sign-in offer exists to avoid.
const REFRESH_MARGIN_MS = 120_000;

export function credentialNeedsRefresh(credential: ProviderCredential, now: number): boolean {
  if (credential.kind !== "oauth") return false;
  if (!credential.credential.refresh.trim()) return false;
  return credential.credential.expires - now <= REFRESH_MARGIN_MS;
}
