// DEVELOPMENT-ONLY API-key seeding. Wraps a keyStore so provider keys absent from the OS
// keychain fall back to values supplied from the environment (e.g. OPENROUTER_API_KEY in
// .env.development.local), letting `yarn dev` (non-mock) reach real cloud providers without hand-entering
// keys. The composition root passes devApiKeys ONLY when ENVIRONMENT === "development" — never in
// production OR the automated testing stage — so this is inert everywhere else. A real STORED key always
// wins over the env fallback. No Electron imports.

import type { AIKeyStore } from "@/ai-system/core/ports";

// Collect provider keys from the environment by the convention <PROVIDER_ID>_API_KEY (uppercased) — e.g.
// openrouter → OPENROUTER_API_KEY. Returns only present, non-blank entries.
export function collectDevApiKeysFromEnv(
  providerIds: string[],
  env: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of providerIds) {
    const value = env[`${id.toUpperCase()}_API_KEY`];
    if (typeof value === "string" && value.trim().length > 0) {
      out[id] = value.trim();
    }
  }
  return out;
}

export function withDevApiKeys(keyStore: AIKeyStore, devApiKeys: Record<string, string>): AIKeyStore {
  const fallback = (provider: string): string | undefined => {
    const value = devApiKeys[provider];
    return typeof value === "string" && value.trim().length > 0 ? value : undefined;
  };
  return {
    getEncryptionStatus: () => keyStore.getEncryptionStatus(),
    hasKey: async (provider: string) => (await keyStore.hasKey(provider)) || fallback(provider) !== undefined,
    getKey: async (provider: string) => (await keyStore.getKey(provider)) ?? fallback(provider),
    setKey: (provider: string, key: string, opts?: { allowDegraded?: boolean }) => keyStore.setKey(provider, key, opts),
    clearKey: (provider: string) => keyStore.clearKey(provider),
  };
}
