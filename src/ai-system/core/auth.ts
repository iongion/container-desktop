// AI provider connection auth
// Pure and React/Electron/node:* -free — uses the `btoa` global (present in the renderer, Electron main,
// and the test runner) instead of `node:Buffer`, so core purity holds. Builds request headers for the
// basic / custom-header schemes ONLY: bearer rides the AI-SDK provider's native apiKey (Anthropic →
// x-api-key, OpenAI/compatible → Authorization: Bearer) and "none" sends nothing.

import type { AIAuthScheme, AIAuthSettings } from "./types";

// Does this scheme carry a secret in the keychain? Only "none" is keyless; bearer/basic/header each store
// one secret (token / password / header value). Drives the broker gate and the discovery NO_KEY pre-check.
export function schemeNeedsSecret(scheme: AIAuthScheme): boolean {
  return scheme !== "none";
}

// Extra request headers for basic / custom-header auth. Bearer and none return {} (bearer is the native
// apiKey; none is unauthenticated). Returns {} rather than a malformed header when the required secret —
// or, for the custom-header scheme, the header name — is missing.
export function buildAuthHeaders(auth: AIAuthSettings, secret?: string): Record<string, string> {
  switch (auth.scheme) {
    case "basic":
      if (!secret) return {};
      return { Authorization: `Basic ${btoa(`${auth.username ?? ""}:${secret}`)}` };
    case "header":
      if (!secret || !auth.headerName) return {};
      return { [auth.headerName]: secret };
    default:
      return {};
  }
}
