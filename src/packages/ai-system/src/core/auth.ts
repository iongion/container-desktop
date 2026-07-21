// AI provider connection auth. Header construction belongs to the shell-specific provider fetch adapter, where
// the keychain value is retrieved; core only decides whether a configured scheme requires a stored secret.

import type { AIAuthScheme } from "./types";

// Does this scheme carry a secret in the keychain? Only "none" is keyless; bearer/basic/header each store
// one secret (token / password / header value). Drives the broker gate and the discovery NO_KEY pre-check.
export function schemeNeedsSecret(scheme: AIAuthScheme): boolean {
  return scheme !== "none";
}
